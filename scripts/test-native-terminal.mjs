// Integration test: real native contracts on a localhost fork, mocked official wallet transport only.
import {spawn} from 'node:child_process';import{mkdtemp,rm,readFile,writeFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';
import{createPublicClient,createWalletClient,http,parseEther,keccak256,erc20Abi}from'viem';import{bsc}from'viem/chains';
import{ChainService}from'../server/live/chain.mjs';import{NativeLaunchpad}from'../server/live/native.mjs';import{WalletService}from'../server/live/wallet.mjs';import{LiveService}from'../server/live/service.mjs';
const url='http://127.0.0.1:18554',owner='0x3146A6095fA037a0a5Ef2593818d216D72a6F1ac',issuer='0x1234567890123456789012345678901234567890',dataDir=await mkdtemp(join(tmpdir(),'bang-native-flow-'));
const fork=spawn('./node_modules/.bin/anvil',['--host','127.0.0.1','--port','18554','--chain-id','56','--hardfork','cancun','--fork-url',process.env.FORK_RPC_URL||'https://bsc-dataseed.bnbchain.org','--accounts','0','--base-fee','0','--silent'],{stdio:'ignore'});
const client=createPublicClient({chain:bsc,cacheTime:0,transport:http(url)}),walletClient=createWalletClient({chain:bsc,transport:http(url),account:issuer}),cfg=JSON.parse(await readFile('contracts/native/mainnet-config.json'));const results=[];
const artifacts=Object.fromEntries(await Promise.all(['BANGLaunchpad','BANGQuoteOracle'].map(async n=>[n,JSON.parse(await readFile('artifacts/native/'+n+'.json'))])));
async function mine(hash){await client.request({method:'anvil_mine',params:['0x2']});for(let i=0;i<80;i++){try{const r=await client.getTransactionReceipt({hash});assert.equal(r.status,'success');return r}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;await new Promise(r=>setTimeout(r,100));}}throw Error('Local receipt unavailable '+hash)}
async function send(tx){const hash=await walletClient.sendTransaction({...tx,nonce:await client.getTransactionCount({address:tx.account,blockTag:'latest'}),gasPrice:10000000000n,gas:8000000n});await mine(hash);return hash}
async function deploy(n,args){const a=artifacts[n],hash=await walletClient.deployContract({abi:a.abi,bytecode:a.bytecode,args,gas:10000000n,gasPrice:10000000000n,nonce:await client.getTransactionCount({address:issuer,blockTag:'latest'})});return(await mine(hash)).contractAddress}
async function funded(a){await client.request({method:'anvil_impersonateAccount',params:[a]});await client.request({method:'anvil_setBalance',params:[a,'0x'+parseEther('10000').toString(16)]})}
try{
 let ok=false;for(let i=0;i<150;i++){try{await client.getChainId();ok=true;break}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ok);await funded(owner);await funded(issuer);
 const oracle=await deploy('BANGQuoteOracle',[cfg.wbnb,cfg.bridge.address,cfg.bridge.pool,cfg.v3Factory,BigInt(cfg.bridge.minLiquidity),cfg.assets.map(a=>a.address),cfg.assets.map(a=>a.pool),cfg.assets.map(a=>BigInt(a.minLiquidity))]);
 const pad=await deploy('BANGLaunchpad',[cfg.registry,oracle,cfg.factory,issuer]);const native=new NativeLaunchpad({client,dataDir,config:{launchpad:pad,oracle,feeRecipient:issuer,launchpadCodeHash:keccak256(await client.getCode({address:pad}))}});
 let sent=0;const previews=new Map();const runner=(s,args)=>({promise:(async()=>{
 if(args.join(' ')==='wallet status')return{status:'CONNECTED'};if(args.join(' ')==='wallet address')return{addresses:[{binanceChainId:'56',address:owner}]};if(args.join(' ')==='wallet settings')return{devMode:{enabled:true,expiresAt:new Date(Date.now()+3600000).toISOString(),dailyLimit:1000},developerModeQuotaUsed:0};
 if(args[1]==='preview'){const id=randomUUID();previews.set(id,{account:args[5],to:args[7],value:BigInt(args[9]),data:args[11]});return{requestId:id,expiresAt:Date.now()+300000,simulationResult:{simulationCode:'000000000'},risks:{riskDetails:[]}}}
 if(args[1]==='execute'){sent++;return{txHash:await send(previews.get(args[3])),status:'BROADCASTED'}}throw Error('Unexpected wallet command')})(),cancel(){}});
 const wallet=new WalletService({dataDir,runner}),key='a'.repeat(64),issuerKey='b'.repeat(64),s=await wallet.get(key);s.control.active=true;await wallet.persist(s);await wallet.refresh(s,true);
 const service=new LiveService({dataDir,wallet,chain:new ChainService({client}),native});
 await service.quick.authorize(key,{confirm:true,includeNativeRWA:true,maxBuyBNB:'1',maxDailyBuyBNB:'2',slippageBps:100,hours:1});
 async function order(token,kind,amount){let j=await service.quick.start(key,{source:'bang',token,kind,amount,slippageBps:100,requestId:randomUUID()});for(let i=0;i<10&&!['CONFIRMED','FAILED'].includes(j.status);i++)j=await service.quick.advance(key,j.id);assert.equal(j.status,'CONFIRMED',j.message);results.push(j);console.log(kind,'confirmed',j.steps.map(x=>x.kind).join(' → '));}
 for(const q of [native.assets()[0],cfg.assets[0]]){
  const p=await service.prepareEVM(issuerKey,{from:issuer,name:'Native '+q.symbol,symbol:'TEST',imageURI:'https://bia-id.fun/brand/bang-logo.png',metadataURI:'https://bia-id.fun/test.json',quote:q.address,targetBNB:'1'});
  assert.equal(sent,results.reduce((n,j)=>n+j.steps.length,0));const hash=await send({account:issuer,to:p.to,data:p.data,value:0n});let receipt=await service.evmReceipt(issuerKey,{id:p.id,fingerprint:p.fingerprint,txHash:hash});assert.equal(receipt.status,'CONFIRMED');const token=receipt.token;assert.ok(token);results.push({kind:'permissionless-issuance',token,hash,steps:[]});
  await assert.rejects(native.trade({token,kind:'buy',amount:'0.001',slippageBps:100},issuer),{code:'NO_AGENT_ID'});
  if(q.pool){await funded(q.pool);const tx=await walletClient.writeContract({account:q.pool,address:q.address,abi:erc20Abi,functionName:'transfer',args:[owner,parseEther('1')],gas:200000n,gasPrice:10000000000n});await mine(tx)}
  await order(token,'buy','0.0001');const t=await native.context(token,owner);assert.ok(BigInt(t.balanceRaw)>0n);await order(token,'sell',t.balance);assert.equal((await native.context(token,owner)).balanceRaw,'0');console.log(q.symbol,'native adapter and quick-grant full flow passed');
 }
 await writeFile('../../outputs/BANG-native-terminal-verification.json',JSON.stringify({complete:true,environment:'Local BSC fork, real native contract and receipt paths; official Binance pairing and wallet transport mocked. No mainnet buys.',results},null,2));
}finally{fork.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true})}
