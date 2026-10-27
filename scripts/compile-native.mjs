import fs from 'node:fs';import path from 'node:path';import solc from 'solc';import{createHash}from'node:crypto';
const sources={},parts=[],seen=new Set();
function collect(key){if(seen.has(key))return;seen.add(key);const file=key.startsWith('@')?'node_modules/'+key:key;let content=fs.readFileSync(file,'utf8');sources[key]={content};
 for(const m of content.matchAll(/import[^;]+["']([^"']+)["'];/g)){const name=m[1].startsWith('@')?m[1]:path.posix.join(path.posix.dirname(key),m[1]);collect(name)}
 parts.push('// Source: '+key+'\n'+content.replace(/import[^;]+;/g,'').replace(/pragma solidity[^;]+;/g,'').replace(/\/\/ SPDX-License-Identifier:[^\n]+/g,''));
}
collect('contracts/native/BANGLaunchpad.sol');collect('contracts/native/BANGQuoteOracle.sol');
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',viaIR:true,outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences','metadata']}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(input)));for(const e of compiled.errors||[])if(e.severity==='error')console.error(e.formattedMessage);if(compiled.errors?.some(e=>e.severity==='error'))process.exit(1);
const dir='artifacts/native';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/standard-input.json',JSON.stringify(input,null,2));
const summary={compiler:solc.version(),optimizer:input.settings.optimizer,evmVersion:'paris',viaIR:true,sourceHash:createHash('sha256').update(JSON.stringify(sources)).digest('hex'),sizes:{}};
for(const n of ['BANGToken','BANGLaunchpad','BANGQuoteOracle']){const a=Object.values(compiled.contracts).find(c=>c[n])?.[n];if(!a)throw Error(n);const init=a.evm.bytecode.object.length/2,runtime=a.evm.deployedBytecode.object.length/2;if(init>49152||runtime>24576)throw Error('Size limit '+n);summary.sizes[n]={initcode:init,runtime};fs.writeFileSync(dir+'/'+n+'.json',JSON.stringify({contractName:n,abi:a.abi,bytecode:'0x'+a.evm.bytecode.object,deployedBytecode:'0x'+a.evm.deployedBytecode.object,immutableReferences:a.evm.deployedBytecode.immutableReferences},null,2));}
const flat='// SPDX-License-Identifier: GPL-2.0-or-later\npragma solidity 0.8.30;\n// Flattened for reading. Deployed verification uses native/standard-input.json.\n// OpenZeppelin Contracts v4.9.6 (MIT); TickMath derived from Uniswap V3 (GPL-2.0-or-later).\n'+parts.join('\n');
fs.writeFileSync(dir+'/BANGNative.sol',flat);fs.writeFileSync(dir+'/build.json',JSON.stringify(summary,null,2));console.log(summary);
