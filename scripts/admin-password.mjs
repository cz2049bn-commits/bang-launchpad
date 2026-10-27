import {passwordHash} from '../server/admin.mjs';
import {readFile,writeFile,chmod} from 'node:fs/promises';
// Run with a TTY: password input is not echoed or placed in shell history.
if(!process.stdin.isTTY){console.error('Run this command in an interactive terminal.');process.exit(1);}
process.stdout.write('New admin password (hidden): ');process.stdin.setRawMode(true);process.stdin.resume();
let value='';process.stdin.setEncoding('utf8');
process.stdin.on('data',async chunk=>{
 for(const c of chunk){
  if(c==='\u0003'){process.stdin.setRawMode(false);process.stdout.write('\n');process.exit(1);}
  if(c==='\r'||c==='\n'){
   process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');
   if(value.length<4){console.error('Use at least 4 characters.');process.exit(1);}
   const hash=await passwordHash(value);value='';
   let current='';try{current=await readFile('.env.local','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
   current=current.split('\n').filter(line=>!line.startsWith('BANG_ADMIN_PASSWORD_HASH=')).join('\n').trim();
   await writeFile('.env.local',(current?current+'\n':'')+'BANG_ADMIN_PASSWORD_HASH='+hash+'\n',{mode:0o600});await chmod('.env.local',0o600);
   console.log('Saved .env.local. Restart the server to apply.');process.exit(0);
  }else if(c==='\u007f')value=value.slice(0,-1);else if(c>=' '&&value.length<256)value+=c;
 }
});
