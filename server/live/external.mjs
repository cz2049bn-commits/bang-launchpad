import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseAbi,erc20Abi,encodeFunctionData,decodeFunctionData,decodeEventLog,parseUnits,formatUnits,formatEther,zeroAddress} from 'viem';
import {address,amount} from './chain.mjs';
import {AppError} from '../../shared/errors.mjs';
import {GANG_PADS} from '../terminal.mjs';

const run=promisify(execFile), same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export const WBNB='0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
export const GANG_COMMON=parseAbi(['function isAgent(address) view returns (bool)','function walletRoom(address,address) view returns (uint256)','function MAX_PER_WALLET() view returns (uint256)']);
export const GANG_SOFT=parseAbi([
 'function curves(address) view returns (address,uint128,uint128,bool,address)',
 'function buy(address,uint256) payable returns (uint256)','function sell(address,uint256,uint256) returns (uint256)',
 'event Buy(address indexed token,address indexed buyer,uint256 bnbIn,uint256 fee,uint256 tokensOut,uint256 realBnb)',
 'event Sell(address indexed token,address indexed seller,uint256 tokensIn,uint256 fee,uint256 bnbOut,uint256 realBnb)',
]);
export const GANG_V2=parseAbi([
 'function curves(address) view returns (address,address,uint128,uint128,uint128,uint128,bool,bool,address,address)',
 'function buy(address,uint256,uint256) returns (uint256)','function sell(address,uint256,uint256) returns (uint256)',
 'event Buy(address indexed token,address indexed buyer,uint256 quoteIn,uint256 taxDividend,uint256 taxPlatform,uint256 tokensOut,uint256 realQuote)',
 'event Sell(address indexed token,address indexed seller,uint256 tokensIn,uint256 taxDividend,uint256 taxPlatform,uint256 quoteOut,uint256 realQuote)',
]);
const WETH_ABI=parseAbi(['function deposit() payable','function withdraw(uint256)','event Deposit(address indexed dst,uint256 wad)','event Withdrawal(address indexed src,uint256 wad)']);
const PAD_IDS={...GANG_PADS,classic:'0x315Ba2e8952D06094CC636b2B84229FA32fb23A7'};
const helper=fileURLToPath(new URL('../vendor/openfour.mjs',import.meta.url));
const OPENFOUR_TRADE='0x8728ba77a8dc0cbf185f23fe65b61fc658a37975e027062c3114394222a10f3f';
const clean=x=>String(x??'').replace(/[\x00-\x1f]/g,'').slice(0,80);
const units=(raw,decimals)=>{if(typeof raw!=='string'||!new RegExp(`^(0|[1-9]\\d{0,30})(\\.\\d{1,${Math.max(1,decimals)}})?$`).test(raw)||(decimals===0&&raw.includes('.')))throw new AppError('Enter a positive decimal amount.');const n=parseUnits(raw,decimals);if(n<=0n)throw new AppError('Amount must be greater than zero.');return n};

export class ExternalTrading {
 constructor({client,helperRunner,native,now=Date.now,rpcUrl=process.env.BSC_RPC_URL||process.env.BIA_RPC_URL}){this.rpcUrl=rpcUrl;this.native=native;this.client=client;this.helperRunner=helperRunner;this.now=now;this.helperBusy=0;this.helperHash=null}
 async fresh(){if(await this.client.getChainId()!==56)throw new AppError('BNB Chain 56 is required.',503);const b=await this.client.getBlock();if(Math.abs(this.now()/1000-Number(b.timestamp))>120)throw new AppError('The RPC block is stale.',503);return b}
 async openFour(command,params){
  if(this.helperRunner)return this.helperRunner(command,params);
  if(this.helperBusy>=4)throw new AppError('Trade checks are busy. Please retry shortly.',429);
  this.helperBusy++;
  try{
   const expected=(await readFile(new URL('../vendor/openfour.sha256',import.meta.url),'utf8')).trim();
   const actual=createHash('sha256').update(await readFile(helper)).digest('hex');
   if(actual!==expected)throw new AppError('Official OpenFour helper integrity check failed.',503);
   const {stdout}=await run(process.execPath,[helper,command,JSON.stringify({...params,...(this.rpcUrl?{rpc:this.rpcUrl}:{})})],{timeout:45000,maxBuffer:500000,env:{PATH:process.env.PATH,NO_COLOR:'1'}}).catch(e=>({stdout:e.stdout||''}));
   let result;try{result=JSON.parse(stdout)}catch{throw new AppError('OpenFour chain check is unavailable.',502)}
   if(!result.success)throw new AppError(String(result.error?.message||'OpenFour rejected this request.').replace(/https?:\/\/\S+/g,'[RPC]').slice(0,400),422,'OPENFOUR_REJECTED');
   const b=await this.client.getBlock({blockNumber:BigInt(result.data.block)});
   if(Math.abs(this.now()/1000-Number(b.timestamp))>120)throw new AppError('OpenFour quote block is stale.',503);
   return result.data;
  }finally{this.helperBusy--}
 }
 async gangContext(token,owner){
  token=address(token);const b=await this.fresh(),blockNumber=b.number;
  const read=(a,abi,fn,args=[])=>this.client.readContract({address:a,abi,functionName:fn,args,blockNumber});
  const candidates=await Promise.all(Object.entries(PAD_IDS).map(async([id,a])=>{const soft=['soft','classic'].includes(id),abi=soft?GANG_SOFT:GANG_V2;try{const c=await read(a,abi,'curves',[token]);return same(c[0],zeroAddress)?null:{id,address:a,soft,abi,c}}catch{return null}}));
  const pad=candidates.find(Boolean);if(!pad)throw new AppError('Token is not registered on a supported Gang launchpad.',404,'TOKEN_NOT_FOUND');
  const quote=pad.soft?WBNB:pad.c[1],graduated=pad.soft?pad.c[3]:pad.c[6];
  const [name,symbol,decimals,quoteSymbol,quoteDecimals,cap,balance,quoteBalance,tokenAllowance,quoteAllowance,isAgent,room,bnb]=await Promise.all([
   read(token,erc20Abi,'name'),read(token,erc20Abi,'symbol'),read(token,erc20Abi,'decimals'),
   read(quote,erc20Abi,'symbol'),read(quote,erc20Abi,'decimals'),read(pad.address,GANG_COMMON,'MAX_PER_WALLET'),
   owner?read(token,erc20Abi,'balanceOf',[owner]):null,owner?read(quote,erc20Abi,'balanceOf',[owner]):null,
   owner?read(token,erc20Abi,'allowance',[owner,pad.address]):null,owner?read(quote,erc20Abi,'allowance',[owner,pad.address]):null,
   owner?read(pad.address,GANG_COMMON,'isAgent',[owner]):null,owner&&!graduated?read(pad.address,GANG_COMMON,'walletRoom',[token,owner]):null,
   owner?this.client.getBalance({address:owner,blockNumber}):null]);
  if(decimals>36||quoteDecimals>36)throw new AppError('Unsupported decimals.');
  return {source:'gang',address:token,name:clean(name),symbol:clean(symbol),decimals,launchpad:pad.address,pad:pad.id,soft:pad.soft,
   quoteAddress:quote,quoteSymbol:pad.soft?'BNB':clean(quoteSymbol),quoteDecimals,graduated,tradable:!graduated,
   agentIdRequired:!graduated,agentQualified:isAgent,cap:formatUnits(cap,decimals),room:room==null?null:formatUnits(room,decimals),
   balance:balance==null?null:formatUnits(balance,decimals),balanceRaw:balance?.toString()??null,
   quoteBalance:quoteBalance==null?null:formatUnits(quoteBalance,quoteDecimals),quoteBalanceRaw:quoteBalance?.toString()??null,
   bnbBalance:bnb==null?null:formatEther(bnb),tokenAllowance:tokenAllowance?.toString()??null,quoteAllowance:quoteAllowance?.toString()??null,
   block:blockNumber.toString(),verification:'onchain-known-launchpad',checkedAt:this.now()};
 }
 async context(source,token,owner){
  if(source==='bang'&&this.native)return this.native.context(token,owner);
  if(source==='gang')return this.gangContext(token,owner);
  if(source!=='openfour')throw new AppError('Unsupported external source.');
  await this.fresh();const d=await this.openFour('info',{token:address(token),...(owner?{wallet:owner}:{})});
  if(d.isAgentIdExclusive!==true)throw new AppError('Not an on-chain OpenFour Agent ID exclusive token.',400,'NOT_AGENT_ID_EXCLUSIVE');
  return {source,address:d.token.address,name:d.token.symbol,symbol:clean(d.token.symbol),decimals:d.token.decimals,
   launchpad:d.contracts.core,quoteAddress:d.quote.address,quoteSymbol:'BNB',quoteAssetSymbol:clean(d.quote.symbol),quoteDecimals:d.quote.decimals,
   graduated:d.market==='outer',tradable:d.route==='contract-call',phase:d.curve.phase.name,agentIdRequired:d.market==='inner',agentQualified:null,
   cap:String(Number(d.curve.maxSupply)/100),balance:d.wallet?.tokenBalance??null,balanceRaw:d.wallet?.tokenBalanceRaw??null,
   bnbBalance:d.wallet?.bnbBalance??null,tokenAllowance:d.wallet?.tokenAllowanceToCore??null,block:String(d.block),verification:'onchain-agent-id-preset',checkedAt:this.now()};
 }
 envelope(kind,owner,to,data,value,summary){return {kind,from:owner,to,data,value:String(value),summary}}
 approval(owner,asset,spender,n,summary){return this.envelope('approve',owner,asset,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[spender,n]}),'0',{...summary,spender,approvalToken:asset,approvalRaw:String(n),allowanceType:'EXACT_AMOUNT',step:n===0n?'reset-approval':'approve'})}
 async trade(body,owner){
  if(body.source==='bang'&&this.native)return this.native.trade(body,owner);
  if(!['buy','sell','unwrap'].includes(body.kind))throw new AppError('Choose buy or sell.');
  if(!Number.isInteger(body.slippageBps)||body.slippageBps<1||body.slippageBps>500)throw new AppError('Slippage must be between 0.01% and 5%.');
  const t=await this.context(body.source,body.token,owner);
  const base={source:body.source,token:t.address,symbol:t.symbol,decimals:t.decimals,launchpad:t.launchpad,requestedKind:body.kind,amount:body.amount,slippageBps:body.slippageBps,quoteSymbol:t.quoteAssetSymbol||t.quoteSymbol,quoteAddress:t.quoteAddress,quoteDecimals:t.quoteDecimals};
  if(body.kind==='unwrap'){
   if(body.source!=='gang'||!same(t.quoteAddress,WBNB))throw new AppError('Unwrap is only available for WBNB.');
   const n=amount(body.amount);if(n>BigInt(t.quoteBalanceRaw))throw new AppError('Insufficient WBNB.');
   return this.envelope('unwrap',owner,WBNB,encodeFunctionData({abi:WETH_ABI,functionName:'withdraw',args:[n]}),'0',{...base,inputUnit:'WBNB',outputUnit:'BNB',output:body.amount,minimum:body.amount,step:'unwrap'});
  }
  if(!t.tradable)throw new AppError('This inner market is closed or migrating. No transaction was prepared.',409,'CURVE_CLOSED');
  if(body.source==='openfour')return this.openFourTrade(body,owner,t,base);
  const isBuy=body.kind==='buy',n=units(body.amount,isBuy?t.quoteDecimals:t.decimals);
  if(isBuy&&t.agentQualified!==true)throw new AppError('This wallet does not hold the Agent ID required by Gang.',403,'NO_AGENT_ID');
  if(isBuy&&Number(t.room)<=0)throw new AppError('Current holding has reached the wallet cap. Sell first to restore room.',409,'HOLDING_CAP_REACHED');
  if(!isBuy&&n>BigInt(t.balanceRaw))throw new AppError('Insufficient token balance.');
  if(isBuy&&!t.soft&&BigInt(t.quoteBalanceRaw)<n){
   if(!same(t.quoteAddress,WBNB))throw new AppError(`Insufficient ${t.quoteSymbol}. This market requires its quote token.`);
   const needed=n-BigInt(t.quoteBalanceRaw);
   return this.envelope('wrap',owner,WBNB,encodeFunctionData({abi:WETH_ABI,functionName:'deposit'}),needed,{...base,amount:formatEther(needed),inputUnit:'BNB',outputUnit:'WBNB',output:formatEther(needed),minimum:formatEther(needed),step:'wrap'});
  }
  const allowance=BigInt(isBuy?t.quoteAllowance:t.tokenAllowance),asset=isBuy?t.quoteAddress:t.address;
  if((!isBuy||!t.soft)&&allowance<n)return this.approval(owner,asset,t.launchpad,allowance>0n?0n:n,{...base,amount:allowance>0n?'0':body.amount,inputUnit:isBuy?t.quoteSymbol:t.symbol});
  const abi=t.soft?GANG_SOFT:GANG_V2;
  const args=isBuy?(t.soft?[t.address,0n]:[t.address,n,0n]):[t.address,n,0n];
  let out;try{out=(await this.client.simulateContract({address:t.launchpad,abi,functionName:body.kind,args,account:owner,value:isBuy&&t.soft?n:0n})).result}catch{throw new AppError('Gang rejected the quote. Check Agent ID, balance, allowance and current market state.',422,'QUOTE_REJECTED')}
  const min=out*BigInt(10000-body.slippageBps)/10000n;if(min<=0n)throw new AppError('Quoted output is too small.');
  args[args.length-1]=min;
  return this.envelope(body.kind,owner,t.launchpad,encodeFunctionData({abi,functionName:body.kind,args}),isBuy&&t.soft?n:0n,
   {...base,inputUnit:isBuy?t.quoteSymbol:t.symbol,outputUnit:isBuy?t.symbol:t.quoteSymbol,output:formatUnits(out,isBuy?t.decimals:t.quoteDecimals),minimum:formatUnits(min,isBuy?t.decimals:t.quoteDecimals),step:'trade',refundNote:isBuy?'Budget is a maximum; any protocol refund returns to the same wallet.':null});
 }
 async openFourTrade(body,owner,t,base){
  const n=units(body.amount,body.kind==='buy'?18:t.decimals);
  if(body.kind==='sell'&&n>BigInt(t.balanceRaw))throw new AppError('Insufficient token balance.');
  const d=await this.openFour(`quote-${body.kind}`,{token:t.address,wallet:owner,amount:body.amount,slippageBps:body.slippageBps,payToken:'BNB',receive:'BNB'});
  if(!same(d.tx?.from,owner)||!same(d.tx?.to,t.launchpad)||d.isAgentIdExclusive!==true||!same(d.token?.address,t.address))throw new AppError('OpenFour transaction binding changed. Request a new quote.',409);
  if(d.approveTx){
   const a=decodeFunctionData({abi:erc20Abi,data:d.approveTx.inputData});
   if(body.kind!=='sell'||!same(d.approveTx.to,t.address)||a.functionName!=='approve'||!same(a.args[0],t.launchpad)||a.args[1]!==n)throw new AppError('Unexpected approval scope.',409);
   const reset=BigInt(t.tokenAllowance)>0n;return this.approval(owner,t.address,t.launchpad,reset?0n:n,{...base,amount:reset?'0':body.amount,inputUnit:t.symbol});
  }
  if(d.simulation?.ok!==true)throw new AppError('OpenFour simulation rejected this transaction.',422,'SIMULATION_FAILED');
  const buy=body.kind==='buy';
  if(buy&&BigInt(d.tx.value)!==n)throw new AppError('Unexpected payment amount.',409);
  return this.envelope(body.kind,owner,d.tx.to,d.tx.inputData,d.tx.value,{...base,inputUnit:buy?'BNB':t.symbol,outputUnit:buy?t.symbol:'BNB',output:buy?d.estimate.tokenAmount:d.estimate.userReceives,minimum:buy?d.minTokenOut:d.minReceive,protocolFee:d.estimate.totalFee,feeUnit:d.estimate.totalFeeSymbol,refund:buy?d.estimate.expectedUnspent:null,step:'trade'});
 }
 async validate(tx){
  if(tx.summary.source==='bang'&&this.native)return this.native.validate(tx);
  const t=await this.context(tx.summary.source,tx.summary.token,tx.from);
  if(!same(t.launchpad,tx.summary.launchpad))throw new AppError('The protocol contract changed. Request a new preview.',409);
  if(tx.kind!=='unwrap'&&!t.tradable)throw new AppError('The inner market closed. Request a new preview.',409,'CURVE_CLOSED');
  if(tx.kind==='buy'&&t.source==='gang'&&t.agentQualified!==true)throw new AppError('Agent ID eligibility changed.',403,'NO_AGENT_ID');
 }
 receiptEvidence(receipt,tx){
  if(tx.summary.source==='bang'&&this.native)return this.native.receiptEvidence(receipt,tx);
  const s=tx.summary,logs=receipt.logs;
  if(tx.kind==='approve')return logs.some(l=>{if(!same(l.address,s.approvalToken))return false;try{const e=decodeEventLog({abi:erc20Abi,eventName:'Approval',...l});return same(e.args.owner,tx.from)&&same(e.args.spender,s.spender)&&e.args.value===BigInt(s.approvalRaw)}catch{return false}})?{step:'approve'}:null;
  if(['wrap','unwrap'].includes(tx.kind))return logs.some(l=>{if(!same(l.address,WBNB))return false;try{const e=decodeEventLog({abi:WETH_ABI,eventName:tx.kind==='wrap'?'Deposit':'Withdrawal',...l});return same(e.args.dst||e.args.src,tx.from)&&e.args.wad===amount(s.amount)}catch{return false}})?{step:tx.kind,output:s.amount,outputUnit:s.outputUnit}:null;
  if(s.source==='gang'){
   for(const l of logs){if(!same(l.address,s.launchpad))continue;for(const abi of [GANG_SOFT,GANG_V2])try{const e=decodeEventLog({abi,eventName:tx.kind==='buy'?'Buy':'Sell',...l}),a=e.args;if(same(a.token,s.token)&&same(a.buyer||a.seller,tx.from)){const raw=tx.kind==='buy'?a.tokensOut:(a.quoteOut??a.bnbOut);if(raw<parseUnits(s.minimum,tx.kind==='buy'?s.decimals:s.quoteDecimals))return null;return {step:'trade',output:formatUnits(raw,tx.kind==='buy'?s.decimals:s.quoteDecimals),outputUnit:s.outputUnit}}}catch{}}
  }else if(s.source==='openfour'){
   for(const l of logs){if(!same(l.address,s.launchpad)||!same(l.topics[0],OPENFOUR_TRADE)||l.topics.length!==4||!same('0x'+l.topics[1].slice(-40),s.token)||!same('0x'+l.topics[2].slice(-40),tx.from))continue;
    const h=l.data.slice(2);if(h.length<15*64)continue;const words=Array.from({length:15},(_,i)=>BigInt('0x'+h.slice(i*64,(i+1)*64)));if((words[0]===1n)!==(tx.kind==='buy'))continue;
    return {step:'trade',tokenAmount:formatUnits(words[4],s.decimals),quoteAmount:formatUnits(words[6],s.quoteDecimals),quoteUnit:s.quoteSymbol};
   }
  }return null;
 }
}
