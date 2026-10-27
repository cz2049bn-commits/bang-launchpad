import {spawn} from 'node:child_process';import {setTimeout} from 'node:timers/promises';import {mineSalt} from '../server/live/chain.mjs';
// Prepare the vanity salt BEFORE opening the fork, so public recent-state RPCs stay usable.
const {salt}=await mineSalt();
const anvil=spawn('./node_modules/.bin/anvil',['--host','127.0.0.1','--port','18549','--chain-id','56','--hardfork','cancun','--fork-url',process.env.FORK_RPC_URL||'https://bsc-rpc.publicnode.com','--accounts','1','--balance','100','--silent'],{stdio:['ignore','ignore','pipe']});
let diagnostics='';anvil.stderr.on('data',d=>{diagnostics+=d.toString().slice(0,1200)});
try{
 let ready=false;for(let i=0;i<100;i++){try{const res=await fetch('http://127.0.0.1:18549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});if((await res.json()).result==='0x38'){ready=true;break}}catch{}if(anvil.exitCode!==null)throw Error(diagnostics||'Anvil exited');await setTimeout(100);}
 if(!ready)throw Error('Local fork startup timeout');
 const child=spawn(process.execPath,['scripts/simulate-flap-fork.mjs'],{env:{...process.env,FORK_SALT:salt},stdio:'inherit'});
 process.exitCode=await new Promise(resolve=>child.once('exit',resolve));
}finally{anvil.kill('SIGTERM');}
