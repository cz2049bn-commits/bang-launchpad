export function scopeKeytar(keytar,scope){
 if(!/^[a-f0-9]{64}$/.test(scope||''))throw new Error('Missing wallet session namespace');
 const service=s=>`${s}:bia:${scope}`;
 return {getPassword:(s,a)=>keytar.getPassword(service(s),a),setPassword:(s,a,p)=>keytar.setPassword(service(s),a,p),deletePassword:(s,a)=>keytar.deletePassword(service(s),a)};
}
