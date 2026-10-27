import {readFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseEther,formatEther,parseUnits} from 'viem';
import {AppError} from '../../shared/errors.mjs';
import {amount} from './chain.mjs';
import {writePrivate} from './wallet.mjs';

const active=new Set(['SUBMITTING','UNKNOWN','PENDING_CONFIRMATION','BROADCASTED','CONFIRMING','RECEIPT_REVIEW']);
const jobId=id=>{if(!/^[a-f0-9-]{36}$/.test(id||''))throw new AppError('Invalid quick order ID.');return id};
const riskWarning=i=>{
 const r=i.review?.risks;
 return (r?.riskDetails?.length||0)>0||Object.values(r?.addresses||{}).some(a=>a.riskDetails?.length)||r?.riskBehaviors?.length>0;
};
export class QuickTrading {
 constructor(service){this.service=service;this.wallet=service.wallet;this.now=service.now;this.locks=new Set()}
 async lock(key,fn){if(this.locks.has(key))throw new AppError('A quick order is being processed.',409);this.locks.add(key);try{return await fn()}finally{this.locks.delete(key)}}
 async load(s,file,fallback=null){try{return JSON.parse(await readFile(join(s.dir,file),'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
 async grant(s){const g=await this.load(s,'quick-grant.json');return g&&s.control.active&&g.generation===s.control.generation&&g.expiresAt>this.now()?g:null}
 async public(key){const s=await this.wallet.get(key),g=await this.grant(s);return {grant:g?{active:true,address:g.address,maxBuyBNB:g.maxBuyBNB,maxDailyBuyBNB:g.maxDailyBuyBNB,slippageBps:g.slippageBps,includeNativeRWA:g.includeNativeRWA===true,expiresAt:g.expiresAt}:null,jobs:await this.jobs(s)}}
 async jobs(s){const files=await readdir(join(s.dir,'quick-jobs')).catch(()=>[]);const jobs=await Promise.all(files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f)).map(f=>this.load(s,'quick-jobs/'+f)));return jobs.filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt).slice(0,10).map(j=>this.view(j))}
 view(j){return {id:j.id,status:j.status,source:j.body.source,token:j.body.token,kind:j.body.kind,amount:j.body.amount,createdAt:j.createdAt,steps:j.steps,message:j.message||null}}
 async save(s,j){await mkdir(join(s.dir,'quick-jobs'),{recursive:true,mode:0o700});await writePrivate(join(s.dir,'quick-jobs',j.id+'.json'),j)}
 async authorize(key,body){return this.lock(key,async()=>{
  const s=await this.wallet.get(key),w=await this.wallet.ready(s);
  if(body.confirm!==true)throw new AppError('Explicit quick trading authorization is required.',403);
  const per=amount(body.maxBuyBNB),daily=amount(body.maxDailyBuyBNB);
  if(per>daily||daily>parseEther('100'))throw new AppError('Daily limit must cover one buy and may not exceed 100 BNB.');
  if(![1,24,168].includes(body.hours)||!Number.isInteger(body.slippageBps)||body.slippageBps<1||body.slippageBps>500)throw new AppError('Invalid authorization limits.');
  const g={address:w.address,generation:w.generation,maxBuyBNB:formatEther(per),maxDailyBuyBNB:formatEther(daily),slippageBps:body.slippageBps,acceptWalletWarnings:body.acceptWalletWarnings===true,includeNativeRWA:body.includeNativeRWA===true,expiresAt:Math.min(this.now()+body.hours*3600000,s.developer.expiresAt),createdAt:this.now()};
  this.wallet.assert(s,w.generation);s.quickEpoch=(s.quickEpoch||0)+1;await writePrivate(join(s.dir,'quick-grant.json'),g);return this.public(key);
 })}
 async revoke(key){const s=await this.wallet.get(key);s.quickEpoch=(s.quickEpoch||0)+1;await writePrivate(join(s.dir,'quick-grant.json'),null);return this.public(key)}
 authorization(s,j){let epoch;return {check:async()=>{await this.ensure(s,j);epoch=s.quickEpoch||0},guard:()=>{if((s.quickEpoch||0)!==epoch||j.authorizedUntil<=this.now())throw new AppError('Quick authorization changed before signing.',403,'QUICK_REVOKED')}}}
 async ensure(s,j){const w=await this.wallet.ready(s),g=await this.grant(s);
  if(!g||g.generation!==j.generation||g.address.toLowerCase()!==w.address.toLowerCase()||j.address?.toLowerCase()!==w.address.toLowerCase()||(j.authorizedUntil&&j.authorizedUntil<=this.now()))throw new AppError('Quick trading authorization expired or was revoked.',403,'QUICK_REVOKED');
  if(j.body.slippageBps>g.slippageBps)throw new AppError('Slippage exceeds your quick trading authorization.',403);
  if(j.rwaQuote&&!g.includeNativeRWA)throw new AppError('Native RWA trading was not authorized.',403);
  if(j.rwaQuote&&j.body.kind==='buy'){const current=await this.rwaValue(j.rwaQuote,j.body.amount,j.quoteDecimals);if(current>amount(j.budgetBNB))throw new AppError('RWA value moved beyond the reserved BNB-equivalent budget. Cancel this order and review a fresh amount.',403);}
  if(j.body.kind==='buy'&&amount(j.budgetBNB||j.body.amount)>amount(g.maxBuyBNB))throw new AppError('Order exceeds the current quick trading limit.',403);
  return g;
 }
 async rwaValue(quote,input,decimals){
  if(typeof input!=='string'||!new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${decimals}})?$`).test(input))throw new AppError('Invalid asset amount.');
  const n=parseUnits(input,decimals);if(n<=0n)throw new AppError('Amount must be positive.');
  const t=await this.service.native.target(quote,'1'),per=BigInt(t.targetRaw);return(n*parseEther('1')+per-1n)/per;
 }
 async start(key,body){return this.lock(key,async()=>{
  const s=await this.wallet.get(key),id=jobId(body.requestId),path='quick-jobs/'+id+'.json';
  if(!['bang','gang','openfour'].includes(body.source)||!['buy','sell'].includes(body.kind))throw new AppError('Quick trading supports BANG, Gang and OpenFour buys and sells.');
  const b={source:body.source,token:body.token,kind:body.kind,amount:body.amount,slippageBps:body.slippageBps};
  const fingerprint=createHash('sha256').update(JSON.stringify(b)).digest('hex'),existing=await this.load(s,path);
  if(existing){if(existing.fingerprint!==fingerprint)throw new AppError('Order ID is already bound to another trade.',409);return this.view(existing)}
  const jobs=await this.jobs(s);if(jobs.some(j=>['RUNNING','WAITING','REVIEW_REQUIRED'].includes(j.status)))throw new AppError('Finish or cancel your existing quick order first.',409);
  if((await this.service.history(s)).some(i=>active.has(i.status)))throw new AppError('Resolve the pending wallet transaction first.',409);
  const w=await this.wallet.ready(s);
  const j={id,body:b,fingerprint,address:w.address,generation:w.generation,createdAt:this.now(),day:new Date(this.now()).toISOString().slice(0,10),status:'RUNNING',steps:[]};
  const t=await this.service.external.context(body.source,body.token,s.address);
  if(!t.tradable)throw new AppError('This inner market is closed.',403);
  const isNative=t.quoteAddress.toLowerCase()==='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
  if(!isNative){if(body.source!=='bang'||!this.service.native)throw new AppError('Quick trading supports BNB/WBNB or the native BANG asset catalog.',403);j.rwaQuote=t.quoteAddress;j.quoteDecimals=t.quoteDecimals;if(body.kind==='buy'){const value=await this.rwaValue(t.quoteAddress,body.amount,t.quoteDecimals);j.budgetBNB=formatEther((value*110n+99n)/100n);}}
  const g=await this.ensure(s,j);j.authorizedUntil=g.expiresAt;
  if(body.kind==='buy'){
   const n=amount(j.budgetBNB||body.amount);if(n>amount(g.maxBuyBNB))throw new AppError('Buy exceeds your per-order BNB limit.',403);
   // Reserve the full requested buy budget before any signing; refunds do not increase the daily limit.
   const ledger=await this.load(s,'quick-budget.json',{}),day=ledger[j.day]||{};
   const spent=Object.values(day).reduce((sum,v)=>sum+BigInt(v),0n);if(spent+n>amount(g.maxDailyBuyBNB))throw new AppError('Buy exceeds your daily BNB limit (UTC).',403);
   day[id]=n.toString();ledger[j.day]=day;for(const d of Object.keys(ledger))if(d<j.day)delete ledger[d];
   await writePrivate(join(s.dir,'quick-budget.json'),ledger);
  }
  await this.save(s,j);return this.advanceUnlocked(key,s,j);
 })}
 async advance(key,id){return this.lock(key,async()=>{const s=await this.wallet.get(key),j=await this.load(s,'quick-jobs/'+jobId(id)+'.json');if(!j)throw new AppError('Order not found.',404);return this.advanceUnlocked(key,s,j)})}
 async advanceUnlocked(key,s,j){
  if(['CONFIRMED','FAILED','CANCELLED'].includes(j.status))return this.view(j);
  try{
   const last=j.steps.at(-1);
   if(last){
    const i=await this.service.operation(key,last.id);Object.assign(last,{status:i.status,txHash:i.txHash,received:i.received,gasCost:i.gasCost});
    if(active.has(i.status)){j.status='WAITING';j.message=i.message||'Waiting for the original transaction receipt. No duplicate submission.';await this.save(s,j);return this.view(j)}
    if(i.status==='REVERTED'){j.status='FAILED';j.message='The transaction reverted. No further step will be submitted.';await this.save(s,j);return this.view(j)}
    if(i.status==='PREVIEW'){
     if(j.status==='REVIEW_REQUIRED'){await this.save(s,j);return this.view(j)}
     // A recovered preview has never been broadcast; resume the same operation under the grant.
     const grant=await this.ensure(s,j);
     if(riskWarning(i)&&!grant.acceptWalletWarnings){j.status='REVIEW_REQUIRED';j.message='The wallet returned a risk warning. Review this exact step before continuing.';await this.save(s,j);return this.view(j)}
     const out=await this.service.execute(key,{id:i.id,fingerprint:i.fingerprint,confirm:true},this.authorization(s,j));Object.assign(last,{status:out.status,txHash:out.txHash});j.status='WAITING';j.message=out.message;await this.save(s,j);return this.view(j);
    }
    if(i.status==='CONFIRMED'&&i.kind===j.body.kind){j.status='CONFIRMED';j.message='Trade confirmed on-chain.';await this.save(s,j);return this.view(j)}
   }
   await this.ensure(s,j);
   if(j.steps.length>=6)throw new AppError('Too many preparation steps. Check the wallet before continuing.',409);
   const i=await this.service.preview(key,j.body);j.steps.push({id:i.id,kind:i.kind,status:i.status,txHash:null});j.status='RUNNING';j.message=null;await this.save(s,j);
   const grant=await this.ensure(s,j);
   if(riskWarning(i)&&!grant.acceptWalletWarnings){j.status='REVIEW_REQUIRED';j.message='The wallet returned a risk warning. Review this exact step before continuing.';await this.save(s,j);return this.view(j)}
   const out=await this.service.execute(key,{id:i.id,fingerprint:i.fingerprint,confirm:true},this.authorization(s,j));Object.assign(j.steps.at(-1),{status:out.status,txHash:out.txHash});j.status='WAITING';j.message=out.message;await this.save(s,j);return this.view(j);
  }catch(e){
   // Unknown submissions remain in LiveService and still block all new spending.
   j.status='FAILED';j.message=e instanceof AppError?e.message:'Order preparation is unavailable. Check the existing transaction history before retrying.';await this.save(s,j);return this.view(j);
  }
 }
 async cancel(key,id){return this.lock(key,async()=>{const s=await this.wallet.get(key),j=await this.load(s,'quick-jobs/'+jobId(id)+'.json');if(!j)throw new AppError('Order not found.',404);j.status='CANCELLED';j.message='Further steps cancelled. Already broadcast transactions are not undone.';await this.save(s,j);return this.view(j)})}
 async read(key,id){const s=await this.wallet.get(key),j=await this.load(s,'quick-jobs/'+jobId(id)+'.json');if(!j)throw new AppError('Order not found.',404);return this.view(j)}
}
