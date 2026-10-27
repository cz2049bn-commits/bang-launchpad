import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {WalletService,writePrivate,checkCompatibility} from '../server/live/wallet.mjs';
import {walletExpiry,launchBlocker} from '../shared/wallet-authorization.mjs';
import {LiveService} from '../server/live/service.mjs';
import {PORTAL,ABI,taxParams,amount,curvePoints,ChainService} from '../server/live/chain.mjs';
import {encodeFunctionData,decodeFunctionData,zeroAddress,zeroHash} from 'viem';
const alice='a'.repeat(64),bob='b'.repeat(64),addr='0x1111111111111111111111111111111111111111';
const other='0x2222222222222222222222222222222222222222',hash='0x'+'d'.repeat(64);
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'bia-live-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=Date.now(),executions=0,fail=false,dev=true,expiry,used=0,walletAddress=addr,release=null;
 const commands=[];
 const runner=(s,args,timeout,guard=()=>{})=>({promise:(async()=>{guard();commands.push({key:s.id,args});if(args.join(' ')==='wallet status')return{status:'CONNECTED'};if(args.join(' ')==='wallet address')return{addresses:[{binanceChainId:'56',address:walletAddress}]};if(args.join(' ')==='wallet settings')return{devMode:{enabled:dev,expiresAt:expiry===undefined?new Date(now+3600000).toISOString():expiry,dailyLimit:1000,balanceExceeded:false},developerModeQuotaUsed:used};if(args.join(' ')==='auth signout')return{};
 if(args[0]==='contract-call'&&args[1]==='preview')return{requestId:'request-mock',expiresAt:now+300000,simulationResult:{simulationCode:'000000000',balanceChanges:[],allowanceChanges:[],authorityChanges:[]},parsedTx:{transactionType:'ContractCall'},risks:{riskDetails:[]},requireConfirmation:false};
 if(args[0]==='contract-call'&&args[1]==='execute'){executions++;if(fail)throw Error('timeout');if(release)await new Promise(r=>release.resolve=r);return{status:'BROADCASTED',txHash:hash,orderId:'order-1'}};
 throw Error('unexpected command');})(),cancel(){}});
 const wallet=new WalletService({dataDir:dir,runner,now:()=>now}),s=await wallet.get(alice);s.control.active=true;await wallet.persist(s);
 const tx={kind:'launch',from:addr,to:PORTAL,data:'0x12345678',value:'0',summary:{symbol:'BIA',predicted:other}};
 const chain={status:async()=>({ready:true,chainId:56}),launch:async()=>structuredClone(tx),trade:async()=>structuredClone(tx),simulate:async()=>({gas:'300000',gasCost:'0.00003',block:'100',balance:'1'}),receipt:async()=>({status:'CONFIRMED',txHash:hash,token:other,confirmations:2})};
 const service=new LiveService({wallet,chain,now:()=>now});
 return {dir,wallet,service,s,commands,executions:()=>executions,setFail:v=>fail=v,setDev:v=>dev=v,setExpiry:v=>expiry=v,setUsed:v=>used=v,setAddress:v=>walletAddress=v,advance:n=>now+=n,hold:()=>release={},release:()=>release.resolve(),tx};
}
const confirm=i=>({id:i.id,fingerprint:i.fingerprint,confirm:true});
const quickBody={source:'gang',token:other,kind:'buy',amount:'0.001',slippageBps:100,requestId:'11111111-1111-4111-8111-111111111111'};
async function quickFixture(t,steps=['buy']){const f=await fixture(t);let index=0;
 f.service.external={context:async()=>({tradable:true,quoteSymbol:'WBNB',quoteAddress:'0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'}),
  trade:async b=>({kind:steps[Math.min(index++,steps.length-1)],from:addr,to:PORTAL,data:'0x12345678',value:'0',summary:{source:'gang',token:other,amount:b.amount,symbol:'TEST'}}),validate:async()=>{},receiptEvidence:()=>({step:'trade'})};
 await f.service.quick.authorize(alice,{confirm:true,maxBuyBNB:'0.002',maxDailyBuyBNB:'0.003',slippageBps:100,hours:1});return f;
}
test('quick grant completes preparation and buy once; duplicate click does not sign again',async t=>{
 const f=await quickFixture(t,['wrap','approve','buy']);let j=await f.service.quick.start(alice,quickBody);assert.equal(j.status,'WAITING');assert.equal(f.executions(),1);
 assert.equal((await f.service.quick.start(alice,quickBody)).id,j.id);assert.equal(f.executions(),1);
 for(let n=0;n<3;n++)j=await f.service.quick.advance(alice,j.id);
 assert.equal(j.status,'CONFIRMED');assert.deepEqual(j.steps.map(s=>s.kind),['wrap','approve','buy']);assert.equal(f.executions(),3);
 await assert.rejects(f.service.quick.read(bob,j.id),{status:404});
 await assert.rejects(f.service.quick.start(alice,{...quickBody,amount:'0.002'}),/already bound/);
});
test('quick authorization is bounded by per-order, daily, slippage and expiry limits',async t=>{
 const f=await quickFixture(t);
 await assert.rejects(f.service.quick.start(alice,{...quickBody,amount:'0.003'}),/limit/);
 await assert.rejects(f.service.quick.start(alice,{...quickBody,slippageBps:200}),/Slippage/);
 let j=await f.service.quick.start(alice,{...quickBody,amount:'0.002'});await f.service.quick.advance(alice,j.id);
 await assert.rejects(f.service.quick.start(alice,{...quickBody,amount:'0.002',requestId:'22222222-2222-4222-8222-222222222222'}),/daily/);
 assert.equal(f.executions(),1);f.advance(3600001);
 await assert.rejects(f.service.quick.start(alice,{...quickBody,requestId:'33333333-3333-4333-8333-333333333333'}),{code:'QUICK_REVOKED'});
});
test('quick revocation during simulation prevents any wallet execution',async t=>{
 const f=await quickFixture(t);let calls=0,resume,entered;
 const started=new Promise(r=>entered=r),base=f.service.chain.simulate;
 f.service.chain.simulate=async tx=>{if(++calls===2){entered();await new Promise(r=>resume=r)}return base(tx)};
 const running=f.service.quick.start(alice,quickBody);await started;await f.service.quick.revoke(alice);resume();
 assert.equal((await running).status,'FAILED');assert.equal(f.executions(),0);
});
test('quick unknown broadcast is never resubmitted; next buy stays blocked',async t=>{
 const f=await quickFixture(t);f.setFail(true);let j=await f.service.quick.start(alice,quickBody);
 for(let n=0;n<3;n++)j=await f.service.quick.advance(alice,j.id);
 assert.equal(j.status,'WAITING');assert.equal(j.steps[0].status,'UNKNOWN');assert.equal(f.executions(),1);
 await assert.rejects(f.service.quick.start(alice,{...quickBody,requestId:'22222222-2222-4222-8222-222222222222'}),/existing quick order/);
});
test('quick risk warnings stop before execution and require exact manual review',async t=>{
 const f=await quickFixture(t),runner=f.wallet.runner;f.wallet.runner=(...args)=>{const task=runner(...args);return {...task,promise:task.promise.then(value=>args[1][1]==='preview'?{...value,risks:{riskDetails:[{title:'New wallet warning'}]}}:value)}};
 const j=await f.service.quick.start(alice,quickBody);assert.equal(j.status,'REVIEW_REQUIRED');assert.equal(f.executions(),0);
 await f.service.quick.advance(alice,j.id);assert.equal(f.executions(),0);
});
test('explicit quick consent permits non-blocking warnings but keeps official preview errors blocked',async t=>{
 const f=await quickFixture(t),runner=f.wallet.runner;
 await f.service.quick.authorize(alice,{confirm:true,acceptWalletWarnings:true,maxBuyBNB:'0.002',maxDailyBuyBNB:'0.003',slippageBps:100,hours:1});
 f.wallet.runner=(...args)=>{const task=runner(...args);return {...task,promise:task.promise.then(v=>args[1][1]==='preview'?{...v,risks:{riskDetails:[{title:'Non-blocking warning'}]}}:v)}};
 let j=await f.service.quick.start(alice,quickBody);assert.equal(f.executions(),1);j=await f.service.quick.advance(alice,j.id);assert.equal(j.status,'CONFIRMED');
 f.wallet.runner=(...args)=>{const task=runner(...args);return {...task,promise:task.promise.then(v=>args[1][1]==='preview'?{...v,simulationResult:{simulationCode:'351803',simulationErrorDetail:'blocked'}}:v)}};
 j=await f.service.quick.start(alice,{...quickBody,requestId:'44444444-4444-4444-8444-444444444444'});assert.equal(j.status,'FAILED');assert.equal(f.executions(),1);
});
test('official CLI ISO expiry and documented numeric expiry normalize to the same timestamp',()=>{
 const expected=Date.parse('2030-01-01T00:00:00Z');
 for(const raw of ['2030-01-01T00:00:00Z','2030-01-01T08:00:00+08:00','2030-01-01T00:00:00.000Z',expected,expected/1000,String(expected/1000)])assert.equal(walletExpiry(raw),expected);
 for(const raw of [null,undefined,'',true,NaN,Infinity,0,-1,{},'not-a-date','2030-13-01T00:00:00Z','2030-01-01 00:00:00'])assert.equal(walletExpiry(raw),null);
});
test('a future CLI ISO expiry enables the UI gate and real transaction preview path without executing',async t=>{
 const f=await fixture(t);f.setExpiry('2030-01-01T08:00:00+08:00');
 const w=await f.wallet.refresh(f.s,true);
 assert.equal(w.developer.expiresAt,Date.parse('2030-01-01T00:00:00Z'));
 assert.equal(launchBlocker(w,{ready:true}),null);
 const preview=await f.service.preview(alice,{kind:'launch'});assert.equal(preview.status,'PREVIEW');assert.equal(f.executions(),0);
});
test('unreadable wallet expiry fails closed in both UI and API before any preview',async t=>{
 const f=await fixture(t);
 for(const raw of [null,'bad-date',NaN,0]){
  f.setExpiry(raw);await assert.rejects(f.service.preview(alice,{kind:'launch'}),{code:'DEVELOPER_EXPIRY_UNKNOWN'});
  assert.equal(launchBlocker({status:f.s.status,developer:f.s.developer},{ready:true}),'DEVELOPER_EXPIRY_UNKNOWN');
 }
 assert.equal(f.commands.some(c=>c.args[0]==='contract-call'),false);
});
test('expired ISO authorization blocks preview and also revokes an earlier executable preview',async t=>{
 const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});
 f.setExpiry('2000-01-01T00:00:00Z');
 await assert.rejects(f.service.execute(alice,confirm(i)),{code:'DEVELOPER_EXPIRED'});
 await assert.rejects(f.service.preview(alice,{kind:'launch'}),{code:'DEVELOPER_EXPIRED'});
 assert.equal(launchBlocker({status:f.s.status,developer:f.s.developer},{ready:true}),'DEVELOPER_EXPIRED');assert.equal(f.executions(),0);
});
test('quota restriction and disconnected protocol produce specific UI blockers',async t=>{
 const f=await fixture(t);f.setUsed(1000);await assert.rejects(f.service.preview(alice,{kind:'launch'}),{code:'DEVELOPER_QUOTA'});
 assert.equal(launchBlocker({status:f.s.status,developer:f.s.developer},{ready:true}),'DEVELOPER_QUOTA');
 f.setUsed(0);const w=await f.wallet.refresh(f.s,true);assert.equal(launchBlocker(w,{ready:false}),'PROTOCOL_UNAVAILABLE');
 assert.equal(launchBlocker({status:'UNCONNECTED'},{ready:true}),'WALLET_REQUIRED');assert.equal(f.executions(),0);
});
test('wallet initialization is deduplicated and isolated by the BIA account key',async t=>{const f=await fixture(t);const [a,b,c]=await Promise.all([f.wallet.get(alice),f.wallet.get(alice),f.wallet.get(bob)]);assert.equal(a,b);assert.notEqual(a.dir,c.dir);assert.notEqual(a.secret,c.secret);assert.notEqual(a.id,c.id);assert.equal(c.control.active,false);const restored=new WalletService({dataDir:f.dir});const [x,y]=await Promise.all([restored.get(alice),restored.get(alice)]);assert.equal(x,y);assert.equal(x.secret,a.secret);});
test('unpaired account status never invokes a host wallet',async t=>{const f=await fixture(t);await f.wallet.refresh(await f.wallet.get(bob));assert.equal(f.commands.length,0);});
test('Developer Mode is checked before any preview',async t=>{const f=await fixture(t);f.setDev(false);await assert.rejects(f.service.preview(alice,{kind:'launch'}),{code:'DEVELOPER_MODE'});assert.equal(f.commands.some(c=>c.args[0]==='contract-call'),false);});
test('preview binds the fixed chain, account and exact envelope; request ID remains server-side',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});assert.equal(i.chainId,56);assert.equal(i.from,addr);assert.equal(i.to,PORTAL);assert.equal('requestId' in i,false);assert.deepEqual(f.commands.find(c=>c.args[0]==='contract-call').args,['contract-call','preview','--binanceChainId','56','--from',addr,'--to',PORTAL,'--value','0','--inputData','0x12345678']);await assert.rejects(f.service.execute(bob,confirm(i)),{status:404});assert.equal(f.executions(),0);});
test('missing acknowledgement or changed fingerprint never signs',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});await assert.rejects(f.service.execute(alice,{id:i.id,fingerprint:i.fingerprint}),{status:403});await assert.rejects(f.service.execute(alice,{...confirm(i),fingerprint:'edited'}),{status:403});assert.equal(f.executions(),0);});
test('expired preview and changed wallet address cannot sign',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});f.setAddress(other);await assert.rejects(f.service.execute(alice,confirm(i)),{code:'ACCOUNT_CHANGED'});f.setAddress(addr);f.advance(180001);await assert.rejects(f.service.execute(alice,confirm(i)),{code:'PREVIEW_EXPIRED'});assert.equal(f.executions(),0);});
test('revocation immediately invalidates an intent, including while wallet is busy',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});f.s.busy=true;await f.wallet.disconnect(f.s);assert.equal(f.s.control.active,false);f.s.busy=false;await assert.rejects(f.service.execute(alice,confirm(i)),{code:'WALLET_REVOKED'});assert.equal(f.executions(),0);});
test('execution is durable and idempotent across service restart',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});const first=await f.service.execute(alice,confirm(i));assert.equal(first.status,'BROADCASTED');assert.equal(f.executions(),1);const restarted=new LiveService({wallet:f.wallet,chain:f.service.chain});assert.equal((await restarted.execute(alice,confirm(i))).txHash,hash);assert.equal(f.executions(),1);const stored=JSON.parse(await readFile(join(f.s.dir,'operations',i.id+'.json'),'utf8'));assert.equal(stored.status,'BROADCASTED');});
test('ambiguous timeout is never retried and blocks another launch',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});f.setFail(true);assert.equal((await f.service.execute(alice,confirm(i))).status,'UNKNOWN');assert.equal((await f.service.execute(alice,confirm(i))).status,'UNKNOWN');assert.equal(f.executions(),1);await assert.rejects(f.service.preview(alice,{kind:'launch'}),{code:'OPERATION_PENDING'});});
test('concurrent execute is rejected, then returns the recorded submission',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});f.hold();const first=f.service.execute(alice,confirm(i));for(let j=0;j<100&&f.executions()===0;j++)await new Promise(r=>setTimeout(r,2));await assert.rejects(f.service.execute(alice,confirm(i)),{code:'WALLET_BUSY'});f.release();assert.equal((await first).status,'BROADCASTED');assert.equal(f.executions(),1);});
test('receipt confirmation resolves the original intent without another signature',async t=>{const f=await fixture(t),i=await f.service.preview(alice,{kind:'launch'});await f.service.execute(alice,confirm(i));const out=await f.service.operation(alice,i.id);assert.equal(out.status,'CONFIRMED');assert.equal(out.token,other);assert.equal(f.executions(),1);});
test('receipt recovery rejects a hash for a different transaction',async()=>{const chain=new ChainService({client:{getTransaction:async()=>({from:other,to:PORTAL,input:'0x12345678',value:0n,blockNumber:101n})}});await assert.rejects(chain.receipt(hash,{tx:{from:addr,to:PORTAL,data:'0x12345678',value:'0'},simulation:{block:'100'}}),{code:'TRANSACTION_MISMATCH'});});
test('public metadata cannot upload without explicit publication consent',async t=>{const f=await fixture(t);await assert.rejects(f.service.metadata(alice,{description:'private draft'}),/Confirm public/);assert.equal(f.commands.length,0);});
test('launch ABI keeps 26 tuple fields and exact wei, no taxes or unknown beneficiary',()=>{const initialBuyWei=amount('0.123456789012345678');assert.equal(initialBuyWei,123456789012345678n);const params=taxParams({name:'BIA Test',symbol:'BIA',metadataCid:'Qm'+'a'.repeat(44),salt:zeroHash,walletAddress:addr,initialBuyWei,buyTaxBps:100,sellTaxBps:250});const data=encodeFunctionData({abi:ABI,functionName:'newTokenV6',args:[params]}),decoded=decodeFunctionData({abi:ABI,data});assert.equal(Object.keys(decoded.args[0]).length,26);assert.equal(decoded.args[0].beneficiary,addr);assert.equal(decoded.args[0].quoteAmt,initialBuyWei);assert.equal(decoded.args[0].quoteToken,zeroAddress);assert.equal(decoded.args[0].buyTaxRate,100);assert.equal(decoded.args[0].sellTaxRate,250);assert.equal(decoded.args[0].mktBps,10000);assert.equal(decoded.args[0].dividendBps,0);assert.equal(decoded.args[0].commissionReceiver,zeroAddress);assert.equal(decoded.args[0].tokenVersion,6);assert.equal(decoded.args[0].migratorType,1);assert.throws(()=>taxParams({...{name:'BIA Test',symbol:'BIA',metadataCid:'Qm'+'a'.repeat(44),salt:zeroHash,walletAddress:addr,initialBuyWei},buyTaxBps:0,sellTaxBps:0}));assert.throws(()=>taxParams({name:'BIA Test',symbol:'BIA',metadataCid:'Qm'+'a'.repeat(44),salt:zeroHash,walletAddress:addr,initialBuyWei,buyTaxBps:1001,sellTaxBps:0}));assert.throws(()=>amount('0.1234567890123456789'));assert.throws(()=>amount('1e-6'));assert.throws(()=>amount('-1'));});
test('live curve follows constant product, not the demo linear formula',()=>{const e=10n**18n;const points=curvePoints({r:10n*e,h:100000000n*e,k:11000000000n*e,dexSupplyThresh:800000000n*e});assert.equal(points.length,61);assert.equal(points[0].reserve,0);assert.ok(Math.abs(points.at(-1).reserve-(11000000000/300000000-10))<1e-10);assert.ok(points.at(-1).price>points[0].price);});
test('reviewed official CLI is pinned to the audited keytar import shape',async()=>assert.equal(await checkCompatibility(),true));
test('actual ESM loader namespaces get/set/delete across two users; missing namespace fails closed',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bia-loader-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const loaders=join(dir,'live'),pkg=join(dir,'node_modules/@binance/agentic-wallet'),keytar=join(dir,'node_modules/@github/keytar');await Promise.all([mkdir(loaders,{recursive:true}),mkdir(pkg,{recursive:true}),mkdir(keytar,{recursive:true})]);
 for(const file of ['register-loader.mjs','keytar-loader.mjs','keytar-bridge.mjs','keytar-scope.mjs'])await copyFile(new URL('../server/live/'+file,import.meta.url),join(loaders,file));
 await writeFile(join(keytar,'index.js'),`const fs=require('node:fs');const file=process.env.FAKE_STORE;const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));module.exports={getPassword:async(s,a)=>read()[s+':'+a]||null,setPassword:async(s,a,p)=>{const d=read();d[s+':'+a]=p;fs.writeFileSync(file,JSON.stringify(d))},deletePassword:async(s,a)=>{const d=read();delete d[s+':'+a];fs.writeFileSync(file,JSON.stringify(d));return true}};`);
 await writeFile(join(pkg,'probe.mjs'),`const {default:k}=await import('@github/keytar');const op=process.argv[2];if(op==='set')await k.setPassword('baw','agentSessionId',process.argv[3]);if(op==='delete')await k.deletePassword('baw','agentSessionId');console.log(await k.getPassword('baw','agentSessionId'));`);
 const store=join(dir,'fake.json');await writeFile(store,'{}');
 const run=(scope,op,value='')=>new Promise(resolve=>{const child=spawn(process.execPath,['--import',join(loaders,'register-loader.mjs'),join(pkg,'probe.mjs'),op,value],{env:{PATH:process.env.PATH,FAKE_STORE:store,...(scope?{BIA_KEYCHAIN_SCOPE:scope}:{})},stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',()=>{});child.on('close',code=>resolve({code,out:out.trim()}))});
 assert.deepEqual(await run(alice,'set','ALICE_SESSION'),{code:0,out:'ALICE_SESSION'});assert.equal((await run(bob,'get')).out,'null');await run(bob,'set','BOB_SESSION');await run(bob,'delete');assert.equal((await run(alice,'get')).out,'ALICE_SESSION');assert.notEqual((await run(null,'get')).code,0);const content=JSON.parse(await readFile(store,'utf8'));assert.deepEqual(Object.keys(content),['baw:bia:'+alice+':agentSessionId']);
});

test('native EVM issuance prepares without any Agentic Wallet pairing or CLI call',async t=>{
 const f=await fixture(t);f.service.native={launch:async(body,from)=>({...f.tx,from,summary:{source:'bang',symbol:'BANG'}})};
 const p=await f.service.prepareEVM(bob,{from:other});assert.equal(p.from,other);assert.equal(p.status,'PREVIEW');assert.equal(f.commands.length,0);
 await assert.rejects(f.service.execute(bob,confirm(p)),/EVM wallet/);assert.equal(f.executions(),0);
 await assert.rejects(f.service.evmReceipt(alice,{id:p.id,fingerprint:p.fingerprint,txHash:hash}),{status:404});
});
test('RWA quick grant uses TWAP BNB equivalents, reserves margin, and stops on valuation changes',async t=>{
 const f=await quickFixture(t,['approve','buy']);let perBNB='100000000000000000000';
 f.service.native={target:async()=>({targetRaw:perBNB})};
 f.service.external.context=async()=>({tradable:true,quoteSymbol:'RWA',quoteAddress:other,quoteDecimals:18});
 const body={...quickBody,source:'bang',amount:'0.1'};
 await assert.rejects(f.service.quick.start(alice,body),/not authorized/);assert.equal(f.executions(),0);
 await f.service.quick.authorize(alice,{confirm:true,includeNativeRWA:true,maxBuyBNB:'0.002',maxDailyBuyBNB:'0.003',slippageBps:100,hours:1});
 await assert.rejects(f.service.quick.start(alice,{...body,amount:'0.3'}),/limit/);
 let j=await f.service.quick.start(alice,body);assert.equal(j.status,'WAITING');assert.equal(f.executions(),1);
 const ledger=JSON.parse(await readFile(join(f.s.dir,'quick-budget.json'),'utf8'));assert.equal(Object.values(Object.values(ledger)[0])[0],'1100000000000000');
 perBNB='50000000000000000000';j=await f.service.quick.advance(alice,j.id);assert.equal(j.status,'FAILED');assert.match(j.message,/value moved/);assert.equal(f.executions(),1);
});
