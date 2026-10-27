// Mainnet fork only: no private keys, real wallet CLI or mainnet broadcast.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,parseEther} from 'viem';
import {bsc} from 'viem/chains';
import {ChainService} from '../server/live/chain.mjs';
import {ExternalTrading} from '../server/live/external.mjs';
import {WalletService} from '../server/live/wallet.mjs';
import {LiveService} from '../server/live/service.mjs';
const url='http://127.0.0.1:18551',owner='0x3146A6095fA037a0a5Ef2593818d216D72a6F1ac';
const exec=promisify(execFile),dataDir=await mkdtemp(join(tmpdir(),'bang-terminal-fork-'));
const fork=spawn('./node_modules/.bin/anvil',['--host','127.0.0.1','--port','18551','--chain-id','56','--hardfork','cancun','--fork-url',process.env.FORK_RPC_URL||'https://bsc-rpc.publicnode.com','--accounts','0','--silent'],{stdio:['ignore','ignore','pipe']});
let diagnostics='';fork.stderr.on('data',d=>diagnostics+=d.toString().slice(0,400));
const client=createPublicClient({chain:bsc,transport:http(url,{retryCount:0,timeout:20000})});
const send=createWalletClient({chain:bsc,transport:http(url),account:owner});
const results=[];
try{
 let ready=false;for(let n=0;n<100;n++){try{if(await client.getChainId()===56){ready=true;break}}catch{}if(fork.exitCode!==null)throw Error(diagnostics);await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'fork ready');
 const forkBlock=(await client.getBlockNumber()).toString();
 await client.request({method:'anvil_impersonateAccount',params:[owner]});await client.request({method:'anvil_setBalance',params:[owner,'0x'+parseEther('10').toString(16)]});
 const external=new ExternalTrading({client,helperRunner:async(command,params)=>{for(let retry=0;retry<3;retry++){const {stdout}=await exec(process.execPath,['server/vendor/openfour.mjs',command,JSON.stringify({...params,rpc:url})],{timeout:45000,maxBuffer:500000,env:{PATH:process.env.PATH}}).catch(e=>({stdout:e.stdout||''}));const j=JSON.parse(stdout);if(!j.success){if(j.error.code==='RPC_UNAVAILABLE'&&retry<2){console.log('Warming fork state, retrying read-only helper');continue}console.error('Fork helper:',JSON.stringify(j.error));throw Error(j.error.message)}return j.data}}});
 const previews=new Map();let sent=0;
 const runner=(s,args)=>({promise:(async()=>{
  if(args.join(' ')==='wallet status')return {status:'CONNECTED'};
  if(args.join(' ')==='wallet address')return {addresses:[{binanceChainId:'56',address:owner}]};
  if(args.join(' ')==='wallet settings')return {devMode:{enabled:true,expiresAt:new Date(Date.now()+3600000).toISOString(),dailyLimit:1000},developerModeQuotaUsed:0};
  if(args.join(' ')==='auth signout')return {};
  if(args[1]==='preview'){const id=randomUUID();previews.set(id,{account:args[5],to:args[7],value:BigInt(args[9]),data:args[11]});return {requestId:id,expiresAt:Date.now()+300000,simulationResult:{simulationCode:'000000000'},parsedTx:{testing:'Local fork only'},risks:{riskDetails:[]}}}
  if(args[1]==='execute'){sent++;const tx=previews.get(args[3]);assert.ok(tx);const txHash=await send.sendTransaction({...tx,gas:2000000n});await client.request({method:'anvil_mine',params:['0x2']});return {txHash,status:'BROADCASTED'}}
  throw Error('Unexpected wallet command');
 })(),cancel(){}});
 const wallet=new WalletService({dataDir,runner}),key='a'.repeat(64),s=await wallet.get(key);s.control.active=true;await wallet.persist(s);await wallet.refresh(s,true);
 const service=new LiveService({dataDir,wallet,chain:new ChainService({client}),external});
 await service.quick.authorize(key,{confirm:true,maxBuyBNB:'1',maxDailyBuyBNB:'2',slippageBps:100,hours:1});
 async function order(source,token,kind,amount){const body={source,token,kind,amount,slippageBps:100,requestId:randomUUID()};let j=await service.quick.start(key,body);const initialSent=sent;assert.equal((await service.quick.start(key,body)).id,j.id);assert.equal(sent,initialSent,'duplicate request never sends again');for(let n=0;n<12&&!['CONFIRMED','FAILED'].includes(j.status);n++)j=await service.quick.advance(key,j.id);assert.equal(j.status,'CONFIRMED',j.message);results.push({source,kind,amount,status:j.status,steps:j.steps});console.log(source,kind,'CONFIRMED',j.steps.map(x=>x.kind).join(' → '));return j}
 const gang='0x7211bb019abf9d971d631f675685f59da0238ea6',four='0x6fb3c56e605aa4d9d3573e655004fdef2a07ffff';
 await assert.rejects(external.trade({source:'gang',token:gang,kind:'buy',amount:'0.0001',slippageBps:100},'0x1111111111111111111111111111111111111111'),{code:'NO_AGENT_ID'});
 await order('gang',gang,'buy','0.0001');let t=await external.context('gang',gang,owner);assert.ok(BigInt(t.balanceRaw)>0n);await order('gang',gang,'sell',t.balance);
 await order('openfour',four,'buy','0.0001');t=await external.context('openfour',four,owner);assert.ok(BigInt(t.balanceRaw)>0n);await order('openfour',four,'sell',t.balance);
 await assert.rejects(service.quick.start(key,{source:'openfour',token:four,kind:'buy',amount:'1.1',slippageBps:100,requestId:randomUUID()}),/limit/);
 await service.quick.revoke(key);await assert.rejects(service.quick.start(key,{source:'openfour',token:four,kind:'buy',amount:'0.0001',slippageBps:100,requestId:randomUUID()}),{code:'QUICK_REVOKED'});
 const output={environment:'Local Anvil fork; wallet pairing/preview mocked; all transactions confined to localhost',chainId:56,forkBlock,owner,realFundsSpent:false,checks:['Gang no-Agent-ID rejected','Gang wrap/approve/buy/approve/sell','OpenFour buy/approve/sell','duplicate request idempotent','per-order cap enforced','revoked quick grant rejected'],results};
 await writeFile('../../outputs/BANG-terminal-fork-verification.json',JSON.stringify(output,null,2));console.log('Saved fork verification. No mainnet transaction submitted.');
}finally{fork.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true})}
