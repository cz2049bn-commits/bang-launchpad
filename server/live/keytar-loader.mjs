export async function resolve(specifier,context,nextResolve){
 if(specifier==='@github/keytar'&&context.parentURL?.includes('/@binance/agentic-wallet/'))return {url:new URL('./keytar-bridge.mjs',import.meta.url).href,shortCircuit:true};
 return nextResolve(specifier,context);
}
