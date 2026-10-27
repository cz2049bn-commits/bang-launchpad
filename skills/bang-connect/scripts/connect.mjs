#!/usr/bin/env node
import {pathToFileURL} from 'node:url';

export const ORIGIN = 'https://bangxt.fun';
export function validateManifest(data) {
  if (data?.schemaVersion !== 1 || data.product !== 'BANG' || data.chainId !== 56 || data.origin !== ORIGIN ||
      data.authorization?.mode !== 'browser-account-pairing' || data.authorization?.provider !== 'Binance Agentic Wallet' ||
      data.authorization?.page !== '/#/wallet' || data.authorization?.credentialsExported !== false)
    throw new Error('BANG integration protocol mismatch. Do not authorize this session.');
  const capabilities = Object.fromEntries(['pairing','bangFlapTrading','gangDiscovery','gangTrading','openFourDiscovery','openFourTrading','independentBangLaunchpad','ordinaryEvmIssuance','agentIdRequiredForInnerBuys','quickTrading','graduatedDexTrading']
    .map(key => [key, data.capabilities?.[key] === true]));
  const terminal = data.routes?.terminal === '/#/terminal' ? ORIGIN + '/#/terminal' : null;
  return {product: 'BANG', chainId: 56, wallet: ORIGIN + '/#/wallet', market: ORIGIN + '/#/market', terminal,
    capabilities, walletAuthorization: 'Check in the same browser; this read-only command cannot inspect your session.',
    execution: 'Enable a bounded quick-trading grant once, then a website Buy/Sell click submits the order. Binance App confirmation may additionally be required.'};
}
export async function doctor(fetcher = fetch) {
  const response = await fetcher(ORIGIN + '/api/integration', {method: 'GET', redirect: 'error', credentials: 'omit',
    headers: {accept: 'application/json'}, signal: AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`BANG integration endpoint unavailable (${response.status}). No authorization was created.`);
  const raw = await response.text();
  if (raw.length > 32768) throw new Error('BANG integration response too large.');
  return validateManifest(JSON.parse(raw));
}
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['links','doctor','--help'].includes(args[0])) throw new Error('Usage: node scripts/connect.mjs links | doctor | --help');
  if (args[0] === '--help') return {usage:'node scripts/connect.mjs links | doctor',node:'22+',dependencies:[],readOnly:true};
  if (args[0] === 'links') return {wallet:ORIGIN+'/#/wallet',market:ORIGIN+'/#/market',note:'Pair from the website in your own browser. No local wallet credentials are uploaded.'};
  return doctor();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().then(result => console.log(JSON.stringify(result,null,2))).catch(() => {
    console.error('BANG connection check failed. No wallet was connected or transaction submitted. Verify the official site and try again.');process.exitCode=1;
  });
