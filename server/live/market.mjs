import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { address, PORTAL } from './chain.mjs';
import { writePrivate } from './wallet.mjs';
import { AppError } from '../../shared/errors.mjs';
const submitted=new Set(['SUBMITTING','UNKNOWN','PENDING_CONFIRMATION','BROADCASTED','CONFIRMING','CONFIRMED','RECEIPT_REVIEW']);
const missing=async(path)=>readdir(path).catch(e=>{if(e.code==='ENOENT')return[];throw e});
export class LaunchMarket {
 constructor({dataDir,chain,now=Date.now}){this.dataDir=dataDir;this.chain=chain;this.now=now;this.records=new Map();this.loaded=false;this.checkedAt=0;this.inflight=null;this.quotes=new Map()}
 invalidate(){this.checkedAt=0;this.quotes.clear()}
 async load(){if(this.loaded)return;try{const saved=JSON.parse(await readFile(join(this.dataDir,'launch-index.json'),'utf8'));for(const r of saved.launches||[])this.records.set(r.address.toLowerCase(),r)}catch(e){if(e.code!=='ENOENT')throw e}this.loaded=true}
 async candidates(){const out=[];for(const owner of await missing(join(this.dataDir,'wallets'))){if(!/^[a-f0-9]{64}$/.test(owner))continue;const dir=join(this.dataDir,'wallets',owner,'operations');for(const file of await missing(dir)){if(!/^[a-f0-9]{32}\.json$/.test(file))continue;const i=JSON.parse(await readFile(join(dir,file),'utf8'));if(i.owner===owner&&i.id===file.slice(0,32)&&i.tx?.kind==='launch'&&i.tx.to?.toLowerCase()===PORTAL.toLowerCase()&&submitted.has(i.status)&&/^0x[\da-fA-F]{64}$/.test(i.result?.txHash||''))out.push(i)}}return out}
 async readIntent(r){return JSON.parse(await readFile(join(this.dataDir,'wallets',r.owner,'operations',`${r.id}.json`),'utf8'))}
 async verify(i){
  const result=await this.chain.receipt(i.result.txHash,i);
  if(result.status!=='CONFIRMED'||result.confirmations<2||result.token?.toLowerCase()!==i.tx.summary.predicted.toLowerCase())return null;
  return {address:address(result.token),creator:i.tx.from,name:i.tx.summary.name,symbol:i.tx.summary.symbol,metadataCid:i.tx.summary.metadataCid,txHash:result.txHash,block:result.block,confirmations:result.confirmations,createdAt:i.createdAt,verifiedAt:this.now(),owner:i.owner,id:i.id};
 }
 async refresh(){
  if(this.inflight)return this.inflight;if(this.checkedAt&&this.now()-this.checkedAt<15000)return;
  this.inflight=(async()=>{await this.load();const candidates=await this.candidates(),known=new Set();
   // A persisted launch intent and its matching receipt are both required; no address import endpoint exists.
   for(let n=0;n<candidates.length;n+=4)await Promise.all(candidates.slice(n,n+4).map(async i=>{const key=i.tx.summary.predicted?.toLowerCase();if(!key)return;known.add(key);try{const r=await this.verify(i);if(r)this.records.set(key,r);else this.records.delete(key)}catch(e){if(e.code==='TRANSACTION_MISMATCH')this.records.delete(key);/* Keep a previously verified launch through a temporary RPC outage. */}}));
   for(const key of this.records.keys())if(!known.has(key))this.records.delete(key);
   await mkdir(this.dataDir,{recursive:true,mode:0o700});await writePrivate(join(this.dataDir,'launch-index.json'),{schema:1,launches:[...this.records.values()]});this.checkedAt=this.now();
  })();try{await this.inflight}finally{this.inflight=null}
 }
 async require(raw,{fresh=false}={}){const key=address(raw).toLowerCase();await this.refresh();const r=this.records.get(key);if(!r)throw new AppError('This token was not launched and confirmed through BANG.',404,'NOT_BIA_LAUNCH');
  if(fresh){try{const verified=await this.verify(await this.readIntent(r));if(!verified){this.records.delete(key);throw new AppError('The launch receipt is no longer confirmed. Trading is unavailable.',409,'LAUNCH_UNCONFIRMED')}this.records.set(key,verified)}catch(e){if(e instanceof AppError)throw e;throw new AppError('Cannot verify this launch on chain. Try again when the RPC is available.',503,'LAUNCH_VERIFY_FAILED')}}return r;
 }
 public(r){return {address:r.address,name:r.name,symbol:r.symbol,creator:r.creator,metadataCid:r.metadataCid,launchTxHash:r.txHash,launchBlock:r.block,createdAt:r.createdAt,verifiedAt:r.verifiedAt,source:'bia',mode:'live'}}
 async list(){await this.refresh();const records=[...this.records.values()].sort((a,b)=>b.createdAt-a.createdAt),tokens=[];
  for(let n=0;n<records.length;n+=4)await Promise.all(records.slice(n,n+4).map(async r=>{let quote=this.quotes.get(r.address);if(!quote||this.now()-quote.time>15000){try{const t=await this.chain.token(r.address,null);quote={time:this.now(),data:{name:t.name,symbol:t.symbol,status:t.status,reserve:t.reserve,price:t.price,sold:t.sold,curveSupply:t.curveSupply,progress:t.progress,block:t.block,checkedAt:t.checkedAt},available:true}}catch{quote={time:this.now(),data:{status:null,reserve:null,price:null,progress:null},available:false}}this.quotes.set(r.address,quote)}tokens.push({...this.public(r),...quote.data,quoteAvailable:quote.available})}));
  tokens.sort((a,b)=>b.createdAt-a.createdAt);return {mode:'live',chainId:56,tokens,updatedAt:this.now()};
 }
}
