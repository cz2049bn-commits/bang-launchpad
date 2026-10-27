// All transactions below execute inside an local Anvil fork. The upstream RPC is read-only.
import {readFile,writeFile} from 'node:fs/promises';
import {JsonRpcProvider,ContractFactory,Contract,AbiCoder,ZeroAddress,ZeroHash} from 'ethers';
import {mineSalt} from '../server/live/chain.mjs';
const checked={block:'latest at simulation start'};
const artifact=JSON.parse(await readFile('artifacts/BANGFactoryV3.json'));
const vaultArtifact=JSON.parse(await readFile('artifacts/BANGVaultV3.json'));
const abi=JSON.parse(await readFile('artifacts/FlapVaultPortal.abi.json'));
const provider=new JsonRpcProvider('http://127.0.0.1:18549',undefined,{cacheTimeout:-1});provider.pollingInterval=25;
const nodeVersion=await provider.send('web3_clientVersion',[]);if(!nodeVersion.toLowerCase().startsWith('anvil'))throw Error('This script only accepts the local Anvil test node on port 18549.');
let result={scope:'Local Anvil BSC fork only; no real deployment or financial transaction.',forkBlock:checked.block,checkedAt:new Date().toISOString(),success:false};
try{
 const signer=await provider.getSigner(),creator=await signer.getAddress();result.forkBlock=String(await provider.getBlockNumber());
 console.log('Fork ready; deploying BANGFactoryV3 in memory.');
 const f=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy([]);await f.waitForDeployment();
 const salt=process.env.FORK_SALT||(await mineSalt()).salt;
 const params={name:'BANG Fork Test',symbol:'BFORK',meta:'Qm'+'a'.repeat(44),dexThresh:1,salt,migratorType:1,quoteToken:ZeroAddress,quoteAmt:0n,permitData:'0x',extensionID:ZeroHash,extensionData:'0x',dexId:0,lpFeeProfile:0,buyTaxRate:100,sellTaxRate:100,taxDuration:3153600000n,antiFarmerDuration:2592000n,mktBps:10000,deflationBps:0,dividendBps:0,lpBps:0,minimumShareBalance:0n,dividendToken:ZeroAddress,commissionReceiver:ZeroAddress,tokenVersion:6,vaultFactory:await f.getAddress(),vaultData:AbiCoder.defaultAbiCoder().encode(['address'],[creator])};
 const portal=new Contract('0x90497450f2a706f1951b5bdda52B4E5d16f34C06',abi,signer);
 console.log('Simulating official Flap VaultPortal V6 launch with BANG factory.');
 
 await portal.newTokenV6WithVault.staticCall(params,{gasLimit:25_000_000});
 const tx=await portal.newTokenV6WithVault(params,{gasLimit:25_000_000});let receipt;try{receipt=await tx.wait();}catch(e){const trace=await provider.send('debug_traceTransaction',[tx.hash,{disableStorage:true,disableMemory:true}]);await writeFile('artifacts/fork-debug.json',JSON.stringify({last:trace.structLogs.slice(-30),calls:trace.structLogs.filter(x=>['CALL','DELEGATECALL','STATICCALL','INVALID','REVERT'].includes(x.op)).map(x=>({pc:x.pc,op:x.op,depth:x.depth,stack:x.stack.slice(-7)}))},null,2));throw e;}
 const created=receipt.logs.map(log=>{try{return portal.interface.parseLog(log)}catch{return null}}).find(log=>log?.name==='FlapTaxVaultTokenCreated');
 if(!created)throw Error('No official vault-token creation event');
 const token=created.args.token,vault=created.args.vault,v=new Contract(vault,vaultArtifact.abi,signer);
 if((await v.dev()).toLowerCase()!==creator.toLowerCase())throw Error('Creator/dev mismatch');
 if((await f.vaultForToken(token)).toLowerCase()!==vault.toLowerCase())throw Error('Registry mismatch');
 if(await provider.getCode(token)==='0x')throw Error('Token not created');
 result={...result,success:true,gasUsed:String(receipt.gasUsed),tokenCreated:true,vaultCreated:true,creatorPreserved:true,quote:await v.vaultQuoteToken(),vaultSpec:await v.vaultSpecVersion(),factorySpec:await f.factorySpecVersion()};
 console.log(JSON.stringify(result,null,2));
}catch(e){result.error=String(e.shortMessage||e.message).slice(0,1500);result.errorData=e.data??e.info?.error?.data??null;console.error(result.error,JSON.stringify(result.errorData),e.code,e.operation,e.info?.error?.message);console.error(String(e.message).slice(0,1800));process.exitCode=1;}finally{await writeFile('artifacts/flap-fork-check.json',JSON.stringify(result,null,2));provider.destroy();}
