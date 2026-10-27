import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {AdminService,passwordHash,matchingRuntime} from '../server/admin.mjs';import {createApp} from '../server/app.mjs';
const F='0x1111111111111111111111111111111111111111',T='0x2222222222222222222222222222222222222222',V='0x3333333333333333333333333333333333333333',D='0x4444444444444444444444444444444444444444',Z='0x'+'0'.repeat(40),G='0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b';
const f=JSON.parse(await readFile(new URL('../server/contracts/BANGFactoryV3.json',import.meta.url))),v=JSON.parse(await readFile(new URL('../server/contracts/BANGVaultV3.json',import.meta.url)));
const hash=await passwordHash('test-password');
async function setup(t){
 const dataDir=await mkdtemp(join(tmpdir(),'bang-admin-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));let time=1700000000000,bad=false;
 const client={getChainId:async()=>56,getBlockNumber:async()=>12345n,getCode:async({address})=>bad?'0x1234':address===F?f.deployedBytecode:address===V?v.deployedBytecode:'0x1234',readContract:async({functionName})=>({bangVersion:'BANG/1.0.0',factorySpecVersion:'v2.3',supportedQuotes:[Z],vaultForToken:V,factory:F,taxToken:T,guardian:G,treasuryState:[D,D,Z,18,false,100n,100n,100n,0n,0n,0n],name:'BANG Test',symbol:'BT'})[functionName]};
 const admin=await new AdminService({dataDir,client,hash,now:()=>time}).init();return{dataDir,admin,client,advance:n=>time+=n,setBad:x=>bad=x};
}
test('admin login is server-side, limited, expiring and revocable',async t=>{
 const {admin,advance}=await setup(t);assert.equal(admin.authorized('bad'),false);await assert.rejects(admin.login('wrong'),{code:'ADMIN_BAD_PASSWORD'});
 const token=await admin.login('test-password');assert.ok(admin.authorized(token));admin.logout(token);assert.equal(admin.authorized(token),false);
 const next=await admin.login('test-password');advance(7_200_001);assert.equal(admin.authorized(next),false);
 for(let n=0;n<5;n++)await assert.rejects(admin.login('wrong'),{code:'ADMIN_BAD_PASSWORD'});
 await assert.rejects(admin.login('test-password'),{code:'ADMIN_RATE_LIMIT'});advance(900_001);assert.ok(await admin.login('test-password'));
 assert.match(admin.cookie('secret',true),/Path=\/api\/admin; HttpOnly; SameSite=Strict; Max-Age=7200; Secure$/);
});
test('admin config persists only verified addresses, tolerates RPC outage without fake data, restores after restart',async t=>{
 const {admin,dataDir,client,setBad}=await setup(t);assert.equal((await admin.publicStatus()).status,'not-deployed');
 await assert.rejects(admin.save('invalid',{factory:F}),{code:'ADMIN_AUTH_REQUIRED'});const token=await admin.login('test-password');
 const factory=await admin.save(token,{factory:F});assert.equal(factory.status,'factory-ready');assert.equal(factory.token,'');
 const full=await admin.save(token,{factory:F,token:T});assert.equal(full.vault,V);assert.equal(full.state.received,'0.0000000000000001');
 const saved=await readFile(join(dataDir,'bang-config.json'),'utf8');assert.equal(saved.includes('password'),false);assert.equal((await stat(join(dataDir,'bang-config.json'))).mode&0o777,0o600);
 setBad(true);await assert.rejects(admin.save(token,{factory:F,token:T}),{code:'FACTORY_MISMATCH'});assert.equal(await readFile(join(dataDir,'bang-config.json'),'utf8'),saved);
 const restarted=await new AdminService({dataDir,client,hash}).init();assert.equal(restarted.config.vault,V);const unavailable=await restarted.publicStatus();assert.equal(unavailable.status,'unavailable');assert.equal('state' in unavailable,false);
});
test('runtime validation rejects changed instruction and accepts only declared immutable substitutions',()=>{
 assert.equal(matchingRuntime(f.deployedBytecode,f),true);assert.equal(matchingRuntime('0xff'+f.deployedBytecode.slice(4),f),false);
 const [{start,length}]=Object.values(v.immutableReferences)[0];const a=2+start*2,b=a+length*2,code=v.deployedBytecode.slice(0,a)+'1'.repeat(length*2)+v.deployedBytecode.slice(b);
 assert.equal(matchingRuntime(code,v),true);assert.equal(matchingRuntime(code+'00',v),false);
 const metadataChanged=f.deployedBytecode.replace(/(a2646970667358221220)[a-f0-9]{64}(64736f6c634300081e0033)/g,(_,a,b)=>a+'1'.repeat(64)+b);assert.equal(matchingRuntime(metadataChanged,f),true);
});
test('admin HTTP route enforces origin, session cookie, logout and private config isolation',async t=>{
 const {admin,dataDir}=await setup(t),distDir=join(dataDir,'dist');await mkdir(distDir);await writeFile(join(distDir,'index.html'),'<title>BANG</title>');
 const liveService={close:async()=>{},market:{list:async()=>({tokens:[]})}};
 const app=await createApp({dataDir,distDir,liveService,adminService:admin}),url=await app.listen(0);t.after(()=>app.close());
 const post=(path,body,cookie,origin=url)=>fetch(url+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 assert.equal((await fetch(url+'/admin')).status,200);assert.equal((await fetch(url+'/api/admin/config')).status,401);
 assert.equal((await post('/api/admin/login',{password:'test-password'},null,'https://wrong.test')).status,403);
 const login=await post('/api/admin/login',{password:'test-password'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
 assert.deepEqual(await (await fetch(url+'/api/admin/session',{headers:{Cookie:cookie}})).json(),{authenticated:true});
 const save=await post('/api/admin/config',{factory:F,token:T},cookie);assert.equal(save.status,200);assert.equal((await save.json()).vault,V);
 const pub=await (await fetch(url+'/api/bang')).json();assert.equal(pub.token,T);assert.equal('hash' in pub,false);
 assert.equal((await fetch(url+'/data/bang-config.json')).status,404);assert.equal((await fetch(url+'/.env.local')).status,404);
 assert.equal((await post('/api/admin/logout',{},cookie)).status,200);assert.equal((await post('/api/admin/config',{factory:F},cookie)).status,401);
 const accounts=JSON.parse(await readFile(join(dataDir,'accounts.json')));assert.equal(Object.keys(accounts.accounts).length,0);
});
