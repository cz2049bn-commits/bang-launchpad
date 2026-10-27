import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {getAddress,isAddress,zeroAddress,formatUnits,erc20Abi} from 'viem';
import {AppError} from '../shared/errors.mjs';
import {writePrivate} from './live/wallet.mjs';
const scrypt=promisify(scryptCallback);
export const ADMIN_COOKIE='bang_admin_session';
const VERSION='BANG/1.0.0',GUARDIAN='0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b';
const factoryArtifact=JSON.parse(await readFile(new URL('./contracts/BANGFactoryV3.json',import.meta.url)));
const vaultArtifact=JSON.parse(await readFile(new URL('./contracts/BANGVaultV3.json',import.meta.url)));
const emptyConfig=()=>({chainId:56,factory:'',token:'',vault:'',updatedAt:null});
function address(value){if(typeof value!=='string'||!isAddress(value,{strict:false})||value.toLowerCase()===zeroAddress)throw new AppError('请输入有效的非零 BSC 合约地址 / Enter a valid nonzero BSC contract address.');return getAddress(value.toLowerCase());}
export function matchingRuntime(code,artifact){
 if(typeof code!=='string'||code.length!==artifact.deployedBytecode.length)return false;
 let actual=code.toLowerCase(),expected=artifact.deployedBytecode.toLowerCase();
 // Source-unit paths affect the IPFS metadata digest, not executable instructions.
 // Mask only the 32-byte digests at metadata offsets present in our trusted artifact.
 for(const match of expected.matchAll(/a2646970667358221220([a-f0-9]{64})64736f6c634300081e0033/g)){
  const a=match.index+'a2646970667358221220'.length,b=a+64;actual=actual.slice(0,a)+'0'.repeat(64)+actual.slice(b);expected=expected.slice(0,a)+'0'.repeat(64)+expected.slice(b);
 }

 for(const ranges of Object.values(artifact.immutableReferences||{}))for(const {start,length}of ranges){const a=2+start*2,b=a+length*2;actual=actual.slice(0,a)+'0'.repeat(length*2)+actual.slice(b);expected=expected.slice(0,a)+'0'.repeat(length*2)+expected.slice(b);}
 return actual===expected;
}
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `${salt}:${Buffer.from(await scrypt(password,salt,64)).toString('hex')}`;}

// Read-only on chain. Configuration never signs, deploys or changes a vault's roles.
export class AdminService {
 constructor({dataDir,client,hash=process.env.BANG_ADMIN_PASSWORD_HASH,now=()=>Date.now()}){
  this.dataDir=dataDir;this.client=client;this.hash=hash;this.now=now;this.sessions=new Map();this.attempts=[];this.config=emptyConfig();this.saving=false;this.cache=null;this.pending=null;
 }
 async init(){try{const v=JSON.parse(await readFile(join(this.dataDir,'bang-config.json'),'utf8'));this.config={chainId:56,factory:v.factory?address(v.factory):'',token:v.token?address(v.token):'',vault:v.vault?address(v.vault):'',updatedAt:v.updatedAt??null};}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
 authorized(cookie){const until=this.sessions.get(cookie);if(until&&until>this.now())return true;this.sessions.delete(cookie);return false;}
 require(cookie){if(!this.authorized(cookie))throw new AppError('请先登录管理页 / Sign in to administration.',401,'ADMIN_AUTH_REQUIRED');}
 async login(password){
  if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(this.hash||''))throw new AppError('服务端尚未配置管理密码 / Server admin password is not configured.',503,'ADMIN_NOT_CONFIGURED');
  this.attempts=this.attempts.filter(t=>t>this.now()-900_000);
  // Global bounded attempts prevent rotating source addresses from guessing the short user-selected password.
  if(this.attempts.length>=5)throw new AppError('登录尝试过多，15 分钟后重试 / Too many attempts. Retry after 15 minutes.',429,'ADMIN_RATE_LIMIT');
  this.attempts.push(this.now());
  const [salt,expected]=this.hash.split(':');const candidate=await scrypt(typeof password==='string'&&password.length<=256?password:'',salt,64);
  if(!timingSafeEqual(candidate,Buffer.from(expected,'hex')))throw new AppError('密码不正确 / Incorrect password.',401,'ADMIN_BAD_PASSWORD');
  const token=randomBytes(32).toString('hex');this.sessions.clear();this.sessions.set(token,this.now()+7_200_000);return token;
 }
 logout(cookie){this.sessions.delete(cookie);}
 cookie(token,secure,clear=false){return `${ADMIN_COOKIE}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${clear?0:7200}${secure?'; Secure':''}`;}
 async verify(input){
  const factory=address(input.factory),token=input.token?address(input.token):'';
  if(await this.client.getChainId()!==56)throw new AppError('RPC 必须连接 BSC 主网 56 / RPC must be BSC mainnet 56.',503);
  const blockNumber=await this.client.getBlockNumber();
  const read=(a,abi,functionName,args=[])=>this.client.readContract({address:a,abi,functionName,args,blockNumber});
  const code=await this.client.getCode({address:factory,blockNumber});
  if(!matchingRuntime(code,factoryArtifact))throw new AppError('Factory 字节码与交付版本不一致。请使用 BANGV3.sol 和随附编译设置 / Factory bytecode does not match this BANG release.',400,'FACTORY_MISMATCH');
  const [version,spec,quotes]=await Promise.all([read(factory,factoryArtifact.abi,'bangVersion'),read(factory,factoryArtifact.abi,'factorySpecVersion'),read(factory,factoryArtifact.abi,'supportedQuotes')]);
  if(version!==VERSION||spec!=='v2.3')throw new AppError('不支持的 Factory 版本 / Unsupported factory version.');
  let vault='',state=null,tokenInfo=null;
  if(token){
   vault=await read(factory,factoryArtifact.abi,'vaultForToken',[token]);
   if(vault===zeroAddress)throw new AppError('该代币未由此 Factory 创建金库 / No vault for this token in this factory.',400,'VAULT_NOT_FOUND');
   const [vCode,tCode]=await Promise.all([this.client.getCode({address:vault,blockNumber}),this.client.getCode({address:token,blockNumber})]);
   if(!matchingRuntime(vCode,vaultArtifact)||!tCode||tCode==='0x')throw new AppError('Vault 字节码或代币代码验证失败 / Vault bytecode or token code verification failed.',400,'VAULT_MISMATCH');
   const [vFactory,vToken,g,s,name,symbol]=await Promise.all([read(vault,vaultArtifact.abi,'factory'),read(vault,vaultArtifact.abi,'taxToken'),read(vault,vaultArtifact.abi,'guardian'),read(vault,vaultArtifact.abi,'treasuryState'),read(token,erc20Abi,'name'),read(token,erc20Abi,'symbol')]);
   if(vFactory.toLowerCase()!==factory.toLowerCase()||vToken.toLowerCase()!==token.toLowerCase()||g.toLowerCase()!==GUARDIAN.toLowerCase())throw new AppError('合约关系验证失败 / Contract relationship mismatch.');
   const [dev,treasury,quote,decimals,paused,balance,accounted,received,spent,rescued,losses]=s;
   const quoteSymbol=quote===zeroAddress?'BNB':await read(quote,erc20Abi,'symbol');
   state={dev,treasury,quote,decimals,paused,quoteSymbol,guardian:g};
   for(const [k,v]of Object.entries({balance,accounted,received,spent,rescued,losses}))state[k]=formatUnits(v,decimals);
   tokenInfo={name:String(name).slice(0,120),symbol:String(symbol).slice(0,32)};
  }
  return {chainId:56,factory,token,vault,block:blockNumber.toString(),version,spec,quotes,state,tokenInfo,checkedAt:new Date(this.now()).toISOString()};
 }
 async save(cookie,input){
  this.require(cookie);if(this.saving)throw new AppError('保存正在进行 / Save in progress.',409);this.saving=true;
  try{
   let verified;try{verified=await this.verify(input);}catch(e){if(e instanceof AppError)throw e;throw new AppError('链上验证未完成，配置没有改变。请稍后重试 / Chain verification failed; configuration unchanged.',502,'CHAIN_UNAVAILABLE');}
   // A slow RPC must not allow an expired or logged-out session to commit.
   this.require(cookie);
   const config={chainId:56,factory:verified.factory,token:verified.token,vault:verified.vault,updatedAt:new Date(this.now()).toISOString()};
   await mkdir(this.dataDir,{recursive:true,mode:0o700});await writePrivate(join(this.dataDir,'bang-config.json'),config);this.config=config;this.cache={...verified,configured:true,status:config.token?'connected':'factory-ready',updatedAt:config.updatedAt};return this.cache;
  }finally{this.saving=false;}
 }
 async publicStatus(){
  if(!this.config.factory)return {...this.config,configured:false,status:'not-deployed'};
  if(this.cache&&this.now()-Date.parse(this.cache.checkedAt)<30_000)return this.cache;
  if(this.pending)return this.pending;
  const snapshot=this.config;
  this.pending=(async()=>{try{const checked=await this.verify(snapshot);const result={...checked,configured:true,status:snapshot.token?'connected':'factory-ready',updatedAt:snapshot.updatedAt};if(this.config===snapshot)this.cache=result;return result;}catch{return {...snapshot,configured:true,status:'unavailable',checkedAt:new Date(this.now()).toISOString()};}})();
  try{return await this.pending;}finally{this.pending=null;}
 }
}
