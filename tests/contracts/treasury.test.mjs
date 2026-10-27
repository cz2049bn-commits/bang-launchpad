import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,JsonRpcSigner,ContractFactory,Contract,AbiCoder,ZeroAddress,ZeroHash,parseEther} from 'ethers';

const PORTAL='0x90497450f2a706f1951b5bdda52B4E5d16f34C06';
const GUARDIAN='0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b';
const factoryArtifact=JSON.parse(await readFile('artifacts/BANGFactoryV3.json'));
const vaultArtifact=JSON.parse(await readFile('artifacts/BANGVaultV3.json'));
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
contract Token {
 uint8 public immutable decimals; mapping(address=>uint256) public balanceOf; uint8 public mode;
 constructor(uint8 d){decimals=d;} function mint(address a,uint256 v) external {balanceOf[a]+=v;}
 function burn(address a,uint256 v) external {balanceOf[a]-=v;} function setMode(uint8 m) external {mode=m;}
 function transfer(address to,uint256 n) external returns(bool){
  if(mode==1)return false; if(mode==2)revert();
  balanceOf[msg.sender]-=n+(mode==4?1:0);balanceOf[to]+=n;
  if(mode==3)assembly{return(0,0)} return true;
 }
}
contract RevenueTax {
 mapping(address=>uint256) public balanceOf;Token public quote;address public vault;
 constructor(address q){quote=Token(q);}function decimals()external pure returns(uint8){return 18;}
 function seed(address v)external{vault=v;balanceOf[v]=50;}
 function transfer(address to,uint256 n)external returns(bool){balanceOf[msg.sender]-=n;balanceOf[to]+=n;quote.mint(vault,10);return true;}
}
contract Rejector {receive() external payable{revert();}}
contract Force {constructor()payable{} function force(address payable a)external{selfdestruct(a);}}
interface IVault {function spend(address,uint256,bytes32)external;function sync()external;}
contract Callback {
 address public v;uint256 public calls;bool public blocked;
 function configure(address a)external{v=a;}
 receive()external payable{calls++;(bool ok,)=v.call(abi.encodeCall(IVault.sync,()));blocked=!ok;if(msg.value>1){(bool sent,)=v.call{value:1}("");require(sent);}}
}
`;
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Mocks.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
assert.equal(compiled.errors?.filter(e=>e.severity==='error').length??0,0);
const mock=compiled.contracts['Mocks.sol'];
const validationType='tuple(uint8 tokenVersion,address quoteToken,uint16 buyTaxRate,uint16 sellTaxRate,uint16 vaultBps,uint16 deflationBps,uint16 dividendBps,uint16 lpBps,address dividendToken,uint256 minimumShareBalance)';
const encode=d=>AbiCoder.defaultAbiCoder().encode([validationType],[d]);
const wait=async p=>(await p).wait();

await test('BANG exact flattened artifact: simulated BSC lifecycle and failure cases',async t=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:5,defaultBalance:100,unlockedAccounts:[PORTAL,GUARDIAN]}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 t.after(async()=>{provider.destroy();await rpc.disconnect()});
 const dev=await provider.getSigner(0),other=await provider.getSigner(1),recipient=await provider.getSigner(2);
 const creator=await dev.getAddress(),dest=await recipient.getAddress();
 for(const a of[PORTAL,GUARDIAN])await rpc.request({method:'evm_setAccountBalance',params:[a,'0x56bc75e2d63100000']});
 const portal=new JsonRpcSigner(provider,PORTAL),guardian=new JsonRpcSigner(provider,GUARDIAN);
 async function deploy(artifact,args=[],options={}){const c=await new ContractFactory(artifact.abi,artifact.bytecode??artifact.evm.bytecode.object,dev).deploy(...args,options);await c.waitForDeployment();return c;}
 const quote=await deploy(mock.Token,[6]),tax=await deploy(mock.Token,[18]),extra=await deploy(mock.Token,[18]);
 const factory=await deploy(factoryArtifact,[[await quote.getAddress()]]);
 let counter=10;
 async function vault(q=ZeroAddress,token){token??='0x'+(++counter).toString(16).padStart(40,'0');const encoded=AbiCoder.defaultAbiCoder().encode(['address'],[dest]);await wait(factory.connect(portal).newVault(token,q,creator,encoded));return new Contract(await factory.vaultForToken(token),vaultArtifact.abi,dev);}
 async function invariant(v){assert.equal(await v.totalRecognized(),await v.accountedQuote()+await v.totalSpent()+await v.totalRescuedQuote()+await v.totalRecognizedLoss());}
 await t.test('factory follows V2.3/V3 discovery and deploys before tax token exists',async()=>{
  const v=await vault();assert.equal(await provider.getCode(await v.taxToken()),'0x');
  assert.equal(await v.factory(),await factory.getAddress());assert.equal(await v.creator(),creator);
  assert.equal(await v.vaultSpecVersion(),'v3');assert.equal(await factory.factorySpecVersion(),'v2.3');
  assert.equal(await v.guardian(),GUARDIAN);assert.equal(await factory.vaultPortal(),PORTAL);
  assert.equal(await v.vaultQuoteToken(),ZeroAddress);assert.equal(await v.quoteDecimals(),18n);
  assert.equal((await v.vaultUISchema()).methods.length,10);assert.equal((await factory.vaultDataSchema()).fields.length,1);
  assert.equal(await factory.isBANGVault(await v.getAddress()),true);
  await assert.rejects(wait(factory.newVault(await tax.getAddress(),ZeroAddress,creator,'0x')));
  await assert.rejects(wait(factory.connect(portal).newVault(await v.taxToken(),ZeroAddress,creator,'0x')));
  await assert.rejects(wait(factory.connect(portal).newVault(await tax.getAddress(),await extra.getAddress(),creator,'0x')));
  await assert.rejects(wait(factory.connect(portal).newVault(await tax.getAddress(),ZeroAddress,creator,'0x12')));
  await assert.rejects(wait(factory.connect(portal).newVault(await tax.getAddress(),ZeroAddress,creator,AbiCoder.defaultAbiCoder().encode(['address'],[ZeroAddress]))));
 });
 await t.test('normalized launch validation enforces tax-token version, quotes and allocation',async()=>{
  const base=[6,ZeroAddress,100,100,10000,0,0,0,ZeroAddress,0];
  assert.equal((await factory.onBeforeLaunch(encode(base)))[0],true);
  for(const [index,value]of[[0,5],[1,await extra.getAddress()],[2,1001],[3,1001],[4,9999],[5,1],[6,1],[7,1]]){const d=[...base];d[index]=value;assert.equal((await factory.onBeforeLaunch(encode(d)))[0],false);}
  const zero=[...base];zero[2]=zero[3]=0;assert.equal((await factory.onBeforeLaunch(encode(zero)))[0],false);
  await assert.rejects(deploy(factoryArtifact,[[await quote.getAddress(),await quote.getAddress()]]));
  await assert.rejects(deploy(factoryArtifact,[[creator]]));
 });
 await t.test('native revenue, duplicate pings, spending and later receipts preserve accounting',async()=>{
  const v=await vault(),a=await v.getAddress();await wait(dev.sendTransaction({to:a,value:parseEther('1')}));
  assert.equal(await v.totalRecognized(),parseEther('1'));assert.equal(await v.pendingRevenue(),0n);
  const ping=await wait(other.sendTransaction({to:a,value:0}));assert.equal(ping.logs.length,0);
  await wait(v.sync());await wait(v.spend(dest,parseEther('0.4'),ZeroHash));
  await wait(dev.sendTransaction({to:a,value:parseEther('0.2')}));
  assert.equal(await v.accountedQuote(),parseEther('0.8'));assert.equal(await v.totalRecognized(),parseEther('1.2'));await invariant(v);
  const force=await deploy(mock.Force,[],{value:9n});await wait(force.force(a));
  assert.equal(await v.pendingRevenue(),9n);await wait(v.connect(other).sync());await invariant(v);
 });
 await t.test('ERC20 6-decimal quote: no ping, failed ping, permissionless recovery and later receipt',async()=>{
  const v=await vault(await quote.getAddress()),a=await v.getAddress();assert.equal(await v.quoteDecimals(),6n);
  await wait(quote.mint(a,1_000_000n));assert.equal(await v.accountedQuote(),0n);assert.equal(await v.pendingRevenue(),1_000_000n);
  await assert.rejects(wait(dev.sendTransaction({to:a,value:0,gasLimit:22000})));assert.equal(await quote.balanceOf(a),1_000_000n);
  const ping=await wait(other.sendTransaction({to:a,value:0,gasLimit:100000}));assert.ok(ping.gasUsed<100000n);
  await wait(v.spend(dest,400_000n,ZeroHash));await wait(quote.mint(a,200_000n));
  // spend synchronizes even if the next protocol wake never occurs.
  await wait(v.spend(dest,100_000n,ZeroHash));assert.equal(await v.totalRecognized(),1_200_000n);assert.equal(await v.accountedQuote(),700_000n);
  const dup=await wait(other.sendTransaction({to:a,value:0}));assert.equal(dup.logs.length,0);await invariant(v);
 });
 await t.test('privileged methods reject outsiders; dev rotation cannot revoke Guardian',async()=>{
  const v=await vault(),o=v.connect(other);await wait(dev.sendTransaction({to:await v.getAddress(),value:100n}));
  for(const action of[()=>o.spend(dest,1,ZeroHash),()=>o.setDev(dest),()=>o.setTreasury(dest),()=>o.setPaused(true),()=>o.rescueAll(),()=>o.rescueAsset(ZeroAddress),()=>o.reconcileLoss()])await assert.rejects(wait(action()));
  await wait(v.setDev(dest));await assert.rejects(wait(v.setPaused(true)));
  await wait(v.connect(guardian).setPaused(true));assert.equal(await v.paused(),true);
  await wait(v.connect(guardian).setDev(creator));await wait(v.setPaused(false));await wait(v.connect(guardian).spend(dest,1,ZeroHash));await invariant(v);
 });
 await t.test('rescueAll transfers native, quote and served tax token in one transaction; extra asset rescue',async()=>{
  const v=await vault(await quote.getAddress(),await tax.getAddress()),a=await v.getAddress();
  await wait(quote.mint(a,1_000_000n));await wait(tax.mint(a,500n));await wait(extra.mint(a,70n));await wait(dev.sendTransaction({to:a,value:123n}));
  const before=await quote.balanceOf(dest);await wait(v.rescueAll());
  assert.equal(await provider.getBalance(a),0n);assert.equal(await quote.balanceOf(a),0n);assert.equal(await tax.balanceOf(a),0n);
  assert.equal(await quote.balanceOf(dest)-before,1_000_000n);assert.equal(await v.totalRescuedQuote(),1_000_000n);assert.equal(await v.paused(),true);
  await wait(v.rescueAsset(await extra.getAddress()));assert.equal(await extra.balanceOf(a),0n);await wait(v.rescueAll());await invariant(v);
  await wait(quote.mint(a,12n));await assert.rejects(wait(v.spend(dest,1,ZeroHash)));await wait(v.setPaused(false));await wait(v.spend(dest,12,ZeroHash));await invariant(v);
 });
 await t.test('rescue sweeps quote revenue dispatched during the served tax-token transfer',async()=>{
  const dispatcher=await deploy(mock.RevenueTax,[await quote.getAddress()]),v=await vault(await quote.getAddress(),await dispatcher.getAddress()),a=await v.getAddress();
  await wait(dispatcher.seed(a));await wait(quote.mint(a,100n));await wait(v.sync());await wait(v.rescueAll());
  assert.equal(await quote.balanceOf(a),0n);assert.equal(await v.accountedQuote(),0n);assert.equal(await v.totalRecognized(),110n);assert.equal(await v.totalRescuedQuote(),110n);await invariant(v);
 });
 await t.test('failed transfers roll back ledger; no-return transfer succeeds; sender extra tax rejected',async()=>{
  const v=await vault(await quote.getAddress()),a=await v.getAddress();await wait(quote.mint(a,100n));await wait(v.sync());
  for(const mode of[1,2,4]){await wait(quote.setMode(mode));await assert.rejects(wait(v.spend(dest,10,ZeroHash)));assert.equal(await v.accountedQuote(),100n);assert.equal(await v.totalSpent(),0n);}
  await wait(quote.setMode(3));await wait(v.spend(dest,10,ZeroHash));await invariant(v);await wait(quote.setMode(0));
 });
 await t.test('rejected native recipient and overdraw roll back; callbacks cannot reenter',async()=>{
  const v=await vault(),a=await v.getAddress(),rejector=await deploy(mock.Rejector),callback=await deploy(mock.Callback);
  await wait(dev.sendTransaction({to:a,value:100n}));await assert.rejects(wait(v.spend(await rejector.getAddress(),10,ZeroHash)));
  await assert.rejects(wait(v.spend(dest,101,ZeroHash)));await assert.rejects(wait(v.spend(a,1,ZeroHash)));await assert.rejects(wait(v.spend(dest,0,ZeroHash)));
  assert.equal(await v.accountedQuote(),100n);await wait(callback.configure(a));await wait(v.spend(await callback.getAddress(),10,ZeroHash));
  assert.equal(await callback.blocked(),true);assert.equal(await v.pendingRevenue(),1n);await wait(v.sync());assert.equal(await v.totalRecognized(),101n);await invariant(v);
 });
 await t.test('external quote loss requires explicit accounting and pauses normal spend',async()=>{
  const v=await vault(await quote.getAddress()),a=await v.getAddress();await wait(quote.mint(a,100n));await wait(v.sync());await wait(quote.burn(a,30n));
  await wait(v.connect(guardian).reconcileLoss());assert.equal(await v.totalRecognizedLoss(),30n);assert.equal(await v.accountedQuote(),70n);assert.equal(await v.paused(),true);await invariant(v);
  await wait(v.rescueAll());assert.equal(await v.totalRescuedQuote(),70n);await invariant(v);await assert.rejects(wait(v.reconcileLoss()));
 });
 await t.test('factory empty vaultData defaults rescue receiver to creator and 18 decimals supported',async()=>{
  const q18=await deploy(mock.Token,[18]),f18=await deploy(factoryArtifact,[[await q18.getAddress()]]),token='0x0000000000000000000000000000000000000077';
  await wait(f18.connect(portal).newVault(token,await q18.getAddress(),creator,'0x'));const v=new Contract(await f18.vaultForToken(token),vaultArtifact.abi,dev);
  assert.equal(await v.treasury(),creator);assert.equal(await v.quoteDecimals(),18n);await wait(q18.mint(await v.getAddress(),parseEther('1')));await wait(v.sync());await invariant(v);
 });
});
