import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writePrivate } from './live/wallet.mjs';
import { AppError } from '../shared/errors.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const identity=a=>({id:a.id,agentId:a.agentId,registeredAt:a.registeredAt,identityType:'platform'});
export class Accounts {
 constructor({dataDir,now=Date.now}){this.dataDir=dataDir;this.now=now;this.queue=Promise.resolve()}
 async init(){
  await mkdir(this.dataDir,{recursive:true,mode:0o700});this.file=join(this.dataDir,'accounts.json');
  try{this.db=JSON.parse(await readFile(this.file,'utf8'));if(this.db.schema!==2||!this.db.accounts)throw Error('Unsupported account database')}
  catch(e){if(e.code!=='ENOENT')throw e;this.db={schema:2,accounts:{}};
   // Preserve the existing cookie-to-wallet namespace, never migrate balances or synthetic assets.
   try{const old=JSON.parse(await readFile(join(this.dataDir,'state.json'),'utf8'));for(const [key,a]of Object.entries(old.accounts||{}))if(/^[a-f0-9]{64}$/.test(key))this.db.accounts[key]=identity(a)}catch(error){if(error.code!=='ENOENT')throw error}
   await writePrivate(this.file,this.db);
  }return this;
 }
 async session(raw){
  if(typeof raw==='string'&&/^[a-f0-9]{64}$/.test(raw)&&this.db.accounts[hash(raw)])return{key:hash(raw),cookie:null};
  const cookie=randomBytes(32).toString('hex'),key=hash(cookie);
  const next=this.queue.then(async()=>{const db=structuredClone(this.db);db.accounts[key]={id:`USER-${randomBytes(8).toString('hex')}`,agentId:`BANG-${randomBytes(6).toString('hex').toUpperCase()}`,registeredAt:this.now(),identityType:'platform'};await writePrivate(this.file,db);this.db=db});this.queue=next.catch(()=>{});await next;return{key,cookie};
 }
 view(key){if(!this.db.accounts[key])throw new AppError('Session expired. Refresh this page.',401,'SESSION_EXPIRED');return identity(this.db.accounts[key])}
}
