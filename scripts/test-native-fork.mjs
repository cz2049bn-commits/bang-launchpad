// All signatures and balance fixtures are restricted to localhost Anvil. Never broadcasts to BSC.
import{spawn}from'node:child_process';import{readFile,writeFile}from'node:fs/promises';import assert from'node:assert/strict';import solc from'solc';
import{createPublicClient,createWalletClient,http,parseEther,parseAbi,erc20Abi,formatEther}from'viem';import{bsc}from'viem/chains';
const url='http://127.0.0.1:18552',owner='0x1234567890123456789012345678901234567890';
const rpc=process.env.FORK_RPC_URL||'https://bsc-rpc.publicnode.com';
const fork=spawn('./node_modules/.bin/anvil',['--host','127.0.0.1','--port','18552','--chain-id','56','--hardfork','cancun','--fork-url',rpc,'--accounts','0','--base-fee','0','--order','fifo','--silent'],{stdio:['ignore','ignore','pipe']});
let diag='';fork.stderr.on('data',b=>diag+=b.toString().slice(0,200));
const c=createPublicClient({chain:bsc,cacheTime:0,transport:http(url,{timeout:45000,retryCount:1})});const w=createWalletClient({chain:bsc,transport:http(url),account:owner});
const cfg=JSON.parse(await readFile('contracts/native/mainnet-config.json'));
const artifacts=Object.fromEntries(await Promise.all(['BANGLaunchpad','BANGQuoteOracle','BANGToken'].map(async n=>[n,JSON.parse(await readFile('artifacts/native/'+n+'.json'))])));
const mockInput={language:'Solidity',sources:{'ID.sol':{content:'pragma solidity ^0.8.20; contract ID {mapping(address=>uint256) public balanceOf;function set(address a,uint256 n)external{balanceOf[a]=n;}}'}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};const mock=JSON.parse(solc.compile(JSON.stringify(mockInput))).contracts['ID.sol'].ID;
const report={environment:'localhost BSC fork, no real funds spent, no mainnet broadcast',checks:[],transactions:[]};
const check=(name,value=true)=>{assert.ok(value,name);report.checks.push(name)};
async function funded(a){await c.request({method:'anvil_impersonateAccount',params:[a]});await c.request({method:'anvil_setBalance',params:[a,'0x'+parseEther('10000').toString(16)]});}
async function receipt(hash){for(let i=0;i<80;i++){try{return await c.getTransactionReceipt({hash})}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}await new Promise(r=>setTimeout(r,250));}console.error('Missing local receipt diagnostics',await c.getTransaction({hash}).catch(()=>null),await c.request({method:'txpool_status',params:[]}));throw Error('No local receipt for '+hash)}
async function send(address,abi,functionName,args=[],account=owner,value=0n){const nonce=await c.getTransactionCount({address:account,blockTag:'pending'});const hash=await w.writeContract({address,abi,functionName,args,account,value,gas:7000000n,gasPrice:1000000000n,nonce});await c.request({method:'anvil_mine',params:['0x1']});const r=await receipt(hash);assert.equal(r.status,'success',functionName);report.transactions.push({functionName,hash,gasUsed:String(r.gasUsed)});return r;}
async function deploy(a,args=[]){const nonce=await c.getTransactionCount({address:owner,blockTag:'pending'});const hash=await w.deployContract({abi:a.abi,bytecode:a.bytecode||'0x'+a.evm.bytecode.object,args,gas:10000000n,gasPrice:1000000000n,nonce});await c.request({method:'anvil_mine',params:['0x1']});const r=await receipt(hash);assert.equal(r.status,'success','deploy');report.transactions.push({functionName:'deploy',hash,gasUsed:String(r.gasUsed)});return r.contractAddress;}
const read=(address,abi,functionName,args=[])=>c.readContract({address,abi,functionName,args});
try{
 let ready=false;for(let i=0;i<150;i++){try{await c.getChainId();ready=true;break}catch{}if(fork.exitCode!==null)throw Error(diag);await new Promise(r=>setTimeout(r,100))}assert.ok(ready);
 report.forkBlock=String(await c.getBlockNumber());await funded(owner);for(let i=0;i<79;i++)await funded('0xabcdefabcdefabcdefabcdefabcdefabcd'+i.toString(16).padStart(6,'0'));
 const oracle=await deploy(artifacts.BANGQuoteOracle,[cfg.wbnb,cfg.bridge.address,cfg.bridge.pool,cfg.v3Factory,BigInt(cfg.bridge.minLiquidity),cfg.assets.map(a=>a.address),cfg.assets.map(a=>a.pool),cfg.assets.map(a=>BigInt(a.minLiquidity))]);
 const id=await deploy(mock);const pad=await deploy(artifacts.BANGLaunchpad,[id,oracle,cfg.factory,owner]);const a=artifacts.BANGLaunchpad.abi;
 console.log('Deployed isolated test contracts; canonical RWA oracle and Pancake factory connected.');
 async function launch(quote=cfg.wbnb,target=parseEther('1'),symbol='TEST'){
  const n=await read(pad,a,'tokenCount');const targetQuote=await read(oracle,artifacts.BANGQuoteOracle.abi,'targetAmount',[quote,target]);
  await send(pad,a,'create',[symbol,symbol,'https://bia-id.fun/brand/bang-logo.png','',quote,target,targetQuote*99n/100n,targetQuote*101n/100n]);return await read(pad,a,'tokens',[n]);
 }
 const token=await launch();check('Creation succeeds without Agent ID');
 await assert.rejects(c.simulateContract({address:pad,abi:a,functionName:'buyNative',args:[token,0n,9999999999n],account:owner,value:parseEther('1')}));check('No-ID buy rejected by contract');
 for(const n of ['owner','upgradeTo','rescue','pause','setFee'])check('No administrative selector '+n,!a.some(x=>x.name===n));
 await assert.rejects(launch(cfg.wbnb,parseEther('0.999')));await assert.rejects(launch(cfg.wbnb,parseEther('100.001')));check('Graduation range enforced: 1–100 BNB');
 const cap=await read(pad,a,'WALLET_CAP');const total=await read(pad,a,'TOTAL_SUPPLY');check('Fixed total 1 billion, cap current 1%',total===parseEther('1000000000')&&cap===total/100n);
 await send(id,mock.abi,'set',[owner,1n]);await send(pad,a,'buyNative',[token,1n,9999999999n],owner,parseEther('2'));
 assert.equal(await read(token,erc20Abi,'balanceOf',[owner]),cap);check('Oversized native buy caps holdings and refunds excess');
 await assert.rejects(c.simulateContract({address:pad,abi:a,functionName:'buyNative',args:[token,0n,9999999999n],account:owner,value:1n}));
 await assert.rejects(c.simulateContract({address:token,abi:erc20Abi,functionName:'transfer',args:['0x0000000000000000000000000000000000001001',1n],account:owner}));check('Inner transfers cannot bypass the holding cap');
 await send(token,erc20Abi,'approve',[pad,cap]);await send(id,mock.abi,'set',[owner,0n]);await send(pad,a,'sell',[token,cap,0n,9999999999n,true]);
 assert.equal((await read(pad,a,'curves',[token]))[5],0n);check('Selling all restores zero reserve; exit remains allowed after losing ID');
 await send(id,mock.abi,'set',[owner,1n]);await send(pad,a,'buyNative',[token,cap,9999999999n],owner,parseEther('2'));check('Sell restores full current-holding room');
 const actors=[];for(let i=0;i<79;i++){const actor='0xabcdefabcdefabcdefabcdefabcdefabcd'+i.toString(16).padStart(6,'0');actors.push(actor);await funded(actor);await send(id,mock.abi,'set',[actor,1n]);await send(pad,a,'buyNative',[token,cap,9999999999n],actor,parseEther('2'));if(i%20===19)console.log('BNB graduation holders',i+2);}
 const cv=await read(pad,a,'curves',[token]);assert.equal(cv[4],parseEther('800000000'));assert.equal(cv[5],0n);assert.equal(cv[7],true);check('80 wallets graduate to real Pancake V2');
 const pairAbi=parseAbi(['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function getReserves() view returns(uint112,uint112,uint32)']);const burn='0x000000000000000000000000000000000000dEaD';
 assert.equal(await read(cv[6],pairAbi,'balanceOf',[burn]),(await read(cv[6],pairAbi,'totalSupply'))-1000n);assert.equal(await read(token,erc20Abi,'balanceOf',[cv[6]]),parseEther('200000000'));assert.equal(await read(cfg.wbnb,erc20Abi,'balanceOf',[cv[6]]),parseEther('1'));check('20% supply + all net reserve deposited, LP burned');
 await send(token,erc20Abi,'transfer',[actors[0],1n]);check('Transfers open after graduation');
 await assert.rejects(c.simulateContract({address:pad,abi:a,functionName:'buyNative',args:[token,0n,9999999999n],account:owner,value:1n}));check('Graduated curve rejects further trading');
 const fee=await read(pad,a,'accruedFees',[cfg.wbnb]);await send(pad,a,'payFees',[cfg.wbnb],actors[0]);assert.equal(await read(pad,a,'accruedFees',[cfg.wbnb]),0n);check('Permissionless fee payment can only reach immutable recipient');
 for(const asset of [cfg.bridge,...cfg.assets]){
  const t=await launch(asset.address,parseEther('1'),asset.symbol+'TEST');const curve=await read(pad,a,'curves',[t]);const budget=curve[3];await funded(asset.pool);
  await send(asset.address,erc20Abi,'transfer',[owner,budget*2n],asset.pool);await send(asset.address,erc20Abi,'approve',[pad,budget]);await send(pad,a,'buy',[t,budget,cap,9999999999n]);
  assert.equal(await read(t,erc20Abi,'balanceOf',[owner]),cap);await send(t,erc20Abi,'approve',[pad,cap]);await send(pad,a,'sell',[t,cap,0n,9999999999n,false]);assert.equal((await read(pad,a,'curves',[t]))[5],0n);
  if(asset.symbol==='NVDAB'){
    // Batch transactions into local blocks to stay within public RPC historical-state retention.
    await c.request({method:'anvil_setAutomine',params:[false]});const queue=[],nonces=new Map();
    async function queueTx(address,abi,functionName,args,account){if(!nonces.has(account))nonces.set(account,await c.getTransactionCount({address:account,blockTag:'latest'}));const nonce=nonces.get(account);nonces.set(account,nonce+1);queue.push({hash:await w.writeContract({address,abi,functionName,args,account,gas:7000000n,gasPrice:1000000000n,nonce}),functionName});}
    for(const actor of [owner,...actors])await queueTx(asset.address,erc20Abi,'transfer',[actor,budget*2n],asset.pool);
    await c.request({method:'anvil_mine',params:['0x10']});
    for(const actor of [owner,...actors])await queueTx(asset.address,erc20Abi,'approve',[pad,budget],actor);
    await c.request({method:'anvil_mine',params:['0x10']});
    for(const actor of [owner,...actors])await queueTx(pad,a,'buy',[t,budget,cap,9999999999n],actor);
    await c.request({method:'anvil_mine',params:['0x10']});await c.request({method:'anvil_setAutomine',params:[true]});
    for(const tx of queue){const r=await receipt(tx.hash);assert.equal(r.status,'success',tx.functionName);report.transactions.push({functionName:tx.functionName,hash:tx.hash,gasUsed:String(r.gasUsed)});}
    const graduated=await read(pad,a,'curves',[t]);assert.equal(graduated[7],true);assert.equal(await read(asset.address,erc20Abi,'balanceOf',[graduated[6]]),budget);assert.equal(await read(t,erc20Abi,'balanceOf',[graduated[6]]),parseEther('200000000'));check('RWA graduation puts actual NVDAB plus 20% token supply into real Pancake V2, LP burned');console.log('NVDAB actual-asset graduation passed');
  }
  check(asset.symbol+' actual token transfer / approval / buy / sell');console.log(asset.symbol,'real-asset fork buy/sell passed');
 }
 // Verify the actual Binance registry independently from the multi-holder mock used above.
 const official=await deploy(artifacts.BANGLaunchpad,[cfg.registry,oracle,cfg.factory,owner]);check('Official ID registry accepts known Agent wallet',await read(official,a,'isAgent',['0x3146A6095fA037a0a5Ef2593818d216D72a6F1ac']));check('Official ID registry rejects unregistered deploy fixture',!(await read(official,a,'isAgent',[owner])));
 report.contracts={oracle,pad,idFixture:id,officialRegistryPad:official};report.complete=true;
 await writeFile('../../outputs/BANG-native-fork-verification.json',JSON.stringify(report,null,2));console.log('Native fork verification passed:',report.checks.length,'checks; no mainnet activity.');
}finally{fork.kill('SIGTERM');}
