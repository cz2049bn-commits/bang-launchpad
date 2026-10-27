import {erc20Abi, formatUnits, isAddress, getAddress} from 'viem';
import {AppError} from '../shared/errors.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {writePrivate} from './live/wallet.mjs';

export const GANG_API = 'https://gang.fun/api';
const FOUR_FEED='https://web3.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/pulse/rank/list/ai';
export const GANG_PADS = {
  v2:'0x1B8F3f69DFa0a7F63d308C7EB0Fd38D8b099966E',
  soft:'0x4E6f13c8A453c1b8b4E20b590082bb233a5b80d7',
  u:'0xF81C4E51c48466c6025B0165b1Ea0F6978c712cb',
  s:'0x60aee38576035E757deD30fF8db8A8DA476430C1',
};
const validAddress=x=>typeof x==='string'&&isAddress(x,{strict:false});
const text=(x,n=80)=>typeof x==='string'?x.replace(/[\x00-\x1f]/g,'').slice(0,n):'';
const num=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const hex=x=>typeof x==='string'&&/^0x[\da-f]{64}$/i.test(x)?x:null;
export function tokenImage(raw){
 if(typeof raw!=='string'||raw.length>2048)return null;
 if(raw.startsWith('/images/web3-data/'))raw='https://bin.bnbstatic.com'+raw;
 if(raw.startsWith('ipfs://'))raw='https://cdn.gang.fun/ipfs/'+raw.slice(7);
 try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)return null;return u.href}catch{return null}
}
export const tokenStage=t=>t.graduated?'graduated':Number(t.progress)>=20?'near':'new';
export function normalizeGang(r,track){
 if(!validAddress(r?.address))return null;
 return {address:getAddress(r.address),name:text(r.name),symbol:text(r.symbol,30),source:'gang',track,
  image:tokenImage(r.logoUrl||r.imageUrl||r.logoURI),agentIdMarket:true,stage:tokenStage({graduated:r.graduated===true,progress:r.progressPct}),
  quoteSymbol:text(r.quoteSymbol||'BNB',20),quoteAddress:validAddress(r.quoteAddress)?r.quoteAddress:null,
  price:num(r.priceQuote??r.priceBnb),priceUsd:num(r.priceUsd)>0?num(r.priceUsd):null,
  fdvUsd:num(r.fdvUsd)>0?num(r.fdvUsd):null,volume24hUsd:num(r.volume24hUsd),holders:num(r.holders),
  progress:num(r.progressPct),reserve:num(r.raisedQuote??r.raisedBnb),graduated:r.graduated===true,
  createdAt:num(r.createdAt),createdTx:hex(r.createdTx),agentIdRequired:r.graduated===false,gateVerification:'indexer-only',
  provenance:'gang_indexer',taxBps:num(r.taxBps),holdersSource:text(r.holdersSource),
  launchpad:Object.values(GANG_PADS).find(a=>a.toLowerCase()===String(r.v2Launchpad).toLowerCase())||null};
}

export class TerminalService {
 constructor({market,client,dataDir,fetcher=fetch,now=Date.now}){this.market=market;this.client=client;this.dataDir=dataDir;this.fetcher=fetcher;this.now=now;this.cache=new Map();this.holdingsCache=new Map();this.seen=new Map();this.scanning=0;this.feedPromise=null}
 async openFour(){
  if(this.feedPromise&&this.now()-this.feedTime<20000)return this.feedPromise;
  this.feedTime=this.now();this.feedPromise=this.loadFour();
  try{return await this.feedPromise}catch(e){this.feedPromise=null;throw e}
 }
 async loadFour(){
  if(!this.loaded){this.loaded=true;if(this.dataDir){try{const rows=JSON.parse(await readFile(join(this.dataDir,'terminal-seen.json'),'utf8'));for(const row of rows)if(validAddress(row.address))this.seen.set(row.address.toLowerCase(),row)}catch{}}}
  const stages=await Promise.allSettled([10,20,30].map(async rankType=>{
   const res=await this.fetcher(FOUR_FEED,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'content-type':'application/json','user-agent':'binance-web3/2.0 (Skill)','accept-encoding':'identity'},body:JSON.stringify({chainId:'56',rankType,protocol:[2004],tokenVersionFilter:{'2004':['openfour.meme.AgentIdExclusive']},limit:100})});
   if(!res.ok)throw Error();const raw=await res.text();if(raw.length>4000000)throw Error();const d=JSON.parse(raw);if(d.success!==true||!Array.isArray(d.data))throw Error();
   return d.data.filter(r=>String(r.chainId)==='56'&&r.protocol===2004&&r.tokenVersion==='openfour.meme.AgentIdExclusive'&&validAddress(r.contractAddress)).map(r=>({address:getAddress(r.contractAddress),image:tokenImage(r.icon),agentIdMarket:true,stage:r.migrateStatus===1?'graduated':(rankType===20||Number(r.progress)>=20)?'near':'new',source:'openfour',track:'agent-id',name:text(r.name),symbol:text(r.symbol,30),quoteSymbol:'BNB',quoteAddress:validAddress(r.pairAnchorAddress)?r.pairAnchorAddress:null,price:null,priceUsd:num(r.price),fdvUsd:num(r.marketCap),volume24hUsd:num(r.volume),holders:num(r.holders),progress:num(r.progress),reserve:null,graduated:r.migrateStatus===1,createdAt:r.createTime?num(r.createTime)/1000:null,createdTx:null,agentIdRequired:r.migrateStatus===0,gateVerification:'indexer-only',provenance:'binance_agent_id_feed',taxBuyPercent:num(r.taxRateBuy),taxSellPercent:num(r.taxRateSell),observedAt:this.now()}));
  }));
  const items=new Map();stages.forEach(r=>{if(r.status==='fulfilled')r.value.forEach(t=>{items.set(t.address.toLowerCase(),t);this.seen.set(t.address.toLowerCase(),t)})});
  if(stages.every(r=>r.status==='rejected'))throw new AppError('OpenFour discovery unavailable.',502);
  while(this.seen.size>5000)this.seen.delete(this.seen.keys().next().value);
  if(this.dataDir){await mkdir(this.dataDir,{recursive:true,mode:0o700});await writePrivate(join(this.dataDir,'terminal-seen.json'),[...this.seen.values()])}
  return {items:[...items.values()],stages:stages.map((r,i)=>({rankType:[10,20,30][i],available:r.status==='fulfilled'})),complete:false,tracked:this.seen.size};
 }
 async gang(path){
  const existing=this.cache.get(path);if(existing&&this.now()-existing.time<15000)return existing.promise;
  const promise=(async()=>{const res=await this.fetcher(GANG_API+path,{signal:AbortSignal.timeout(10000),redirect:'error',headers:{accept:'application/json'}});
   if(!res.ok)throw new AppError(`Gang API ${res.status}`,502,'GANG_UNAVAILABLE');
   const raw=await res.text();if(raw.length>3000000)throw new AppError('Gang response is too large',502);return JSON.parse(raw)})();
  this.cache.set(path,{time:this.now(),promise});if(this.cache.size>120)this.cache.delete(this.cache.keys().next().value);
  try{return await promise}catch(e){this.cache.delete(path);throw e}
 }
 async page(track,offset=0,limit=50){
  const prefix=track==='stocks'?'/stocks/tokens':'/tokens';
  const data=await this.gang(`${prefix}?sort=new&limit=${limit}&offset=${offset}`);
  if(!Array.isArray(data.items))throw new AppError('Invalid Gang market response',502);
  return {items:data.items.map(r=>normalizeGang(r,track)).filter(Boolean),hasMore:data.hasMore===true,nextOffset:num(data.nextOffset)};
 }
 async markets(params){
  const offset=Number(params.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new AppError('Invalid page offset');
  const results=await Promise.allSettled([this.market.list(),this.page('main',offset,200),this.page('stocks',offset,200),this.openFour()]);
  const items=[],sources=[];
  results.forEach((r,i)=>{const id=['bang','gang-main','gang-stocks','openfour'][i];
   if(r.status==='rejected'){sources.push({id,available:false,error:'Source unavailable'});return}
   if(i===3){items.push(...r.value.items);sources.push({id,available:true,hasMore:false,complete:false,tracked:r.value.tracked,stages:r.value.stages});return}
   if(i===0){items.push(...r.value.tokens.map(t=>({...t,source:'bang',track:t.track||'legacy',createdAt:Math.floor(t.createdAt/1000),createdTx:t.launchTxHash||null,provenance:'bang_chain_catalog'})));sources.push({id,available:true,hasMore:false})}
   else{items.push(...r.value.items);sources.push({id,available:true,hasMore:r.value.hasMore,nextOffset:r.value.nextOffset})}
  });
  return {chainId:56,items:[...new Map(items.map(t=>[t.address.toLowerCase(),t])).values()],sources,offset,pageSize:200,fetchedAt:this.now(),bangLaunchpad:{deployed:results[0].status==='fulfilled'&&results[0].value.deployed===true},scope:'BANG confirmed launches, Gang index pages and up to 100 OpenFour Agent ID tokens per stage plus observed history. Not an exhaustive BSC scan. Indexed gate labels are rechecked on-chain before trading.'};
 }
 async detail(params){
  const address=params.get('address');if(!validAddress(address))throw new AppError('Invalid token address');
  const track=params.get('track');if(!['main','stocks'].includes(track))throw new AppError('Invalid Gang market');
  const base=`${track==='stocks'?'/stocks':''}/tokens/${address.toLowerCase()}`;
  const row=await this.gang(base),token=normalizeGang(row,track);
  if(!token||token.address.toLowerCase()!==address.toLowerCase())throw new AppError('Token response mismatch',502);
  const data=await Promise.allSettled([this.gang(base+'/candles?res=5m'),this.gang(base+'/trades?limit=30&offset=0&side=all&sort=ts_desc'),this.gang(base+'/holders?limit=30&offset=0')]);
  const value=i=>data[i].status==='fulfilled'?data[i].value:null;
  const candles=Array.isArray(value(0))?value(0).filter(c=>['t','o','h','l','c','v'].every(k=>num(c[k])!==null)&&c.t>0&&c.l>0&&c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c)).slice(-120).map(c=>Object.fromEntries(['t','o','h','l','c','v'].map(k=>[k,Number(c[k])]))):null;
  const trades=value(1)?.items?.filter(t=>hex(t.tx)&&validAddress(t.trader)).map(t=>({tx:t.tx,trader:t.trader,handle:text(t.traderHandle),side:t.side==='buy'?'buy':t.side==='sell'?'sell':'unknown',tokens:num(t.tokens),quote:num(t.quoteIn??t.bnb),ts:num(t.ts),price:num(t.price)}))??null;
  const holders=value(2)?.items?.filter(h=>validAddress(h.holder)).map(h=>({address:h.holder,handle:text(h.handle),balance:num(h.balance),pct:num(h.pct)}))??null;
  return {token,candles,trades,holders,holderNote:text(value(2)?.note,300),fetchedAt:this.now(),source:'gang.fun public indexer',chartUnit:token.quoteSymbol,interval:'5m'};
 }
 async holdings(params){
  const raw=params.get('wallet');if(!validAddress(raw))throw new AppError('Enter a full BSC wallet address');const wallet=getAddress(raw);
  const saved=this.holdingsCache.get(wallet);if(saved&&this.now()-saved.time<20000)return saved.promise;
  if(this.scanning>=2)throw new AppError('Holdings scan is busy. Try again shortly.',429);
  this.scanning++;const promise=this.scanHoldings(wallet).finally(()=>this.scanning--);this.holdingsCache.set(wallet,{time:this.now(),promise});if(this.holdingsCache.size>20)this.holdingsCache.delete(this.holdingsCache.keys().next().value);
  try{return await promise}catch(e){this.holdingsCache.delete(wallet);throw e}
 }
 async scanHoldings(wallet){
  if(!this.client||await this.client.getChainId()!==56)throw new AppError('BSC RPC unavailable or wrong chain',503);
  const block=await this.client.getBlock();if(Math.abs(this.now()/1000-Number(block.timestamp))>120)throw new AppError('BSC RPC block is stale',503);
  const tokens=new Map(),coverage=[];
  await Promise.all(['main','stocks','bang','openfour'].map(async track=>{let count=0,complete=false;
   try{if(track==='bang'){for(const r of (await this.market.list()).tokens){tokens.set(r.address.toLowerCase(),{address:r.address,name:r.name,symbol:r.symbol,source:'bang',track:'native',agentIdMarket:true,agentIdRequired:r.agentIdRequired,image:r.image,graduated:r.graduated,stage:r.stage});count++}complete=true}
    else if(track==='openfour'){await this.openFour();for(const r of this.seen.values()){tokens.set(r.address.toLowerCase(),r);count++}}
    else{for(let page=0;page<10;page++){const data=await this.page(track,page*100,100);for(const r of data.items){tokens.set(r.address.toLowerCase(),r);count++}if(!data.hasMore){complete=true;break}}}
    coverage.push({source:track,listed:count,complete});
   }catch{coverage.push({source:track,listed:count,complete:false,error:'Source unavailable'})}
  }));
  const rows=[...tokens.values()],items=[];let failed=0;
  for(let n=0;n<rows.length;n+=80){const batch=rows.slice(n,n+80);const calls=batch.flatMap(t=>[{address:t.address,abi:erc20Abi,functionName:'balanceOf',args:[wallet]},{address:t.address,abi:erc20Abi,functionName:'decimals'}]);
   const results=await this.client.multicall({contracts:calls,blockNumber:block.number,allowFailure:true});
   batch.forEach((t,i)=>{const balance=results[i*2],decimals=results[i*2+1];if(balance.status!=='success'||decimals.status!=='success'){failed++;return}if(balance.result>0n)items.push({...t,balance:formatUnits(balance.result,decimals.result),balanceRaw:balance.result.toString(),decimals:decimals.result})});
  }
  return {wallet,chainId:56,block:block.number.toString(),blockTimestamp:Number(block.timestamp),items,scanned:rows.length,failed,coverage,complete:failed===0&&coverage.every(c=>c.complete),fetchedAt:this.now(),scope:'Only BANG, Gang and observed OpenFour catalogs; not a full-wallet asset inventory'};
 }
 async handle(path,params){if(path==='/api/terminal/markets')return this.markets(params);if(path==='/api/terminal/detail')return this.detail(params);if(path==='/api/terminal/holdings')return this.holdings(params);throw new AppError('Terminal endpoint not found',404)}
}
