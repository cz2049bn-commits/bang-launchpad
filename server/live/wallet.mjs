import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../shared/errors.mjs';
import { walletExpiry, developerBlocker } from '../../shared/wallet-authorization.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = join(root, 'node_modules/@binance/agentic-wallet/dist/index.js');
const loader = fileURLToPath(new URL('./register-loader.mjs', import.meta.url));
// Pin the reviewed CLI: its dynamic keytar import must pass through our namespace loader.
const CLI_SHA256 = 'eebeb92f96b27de116ed037d97fde2cf8586e7b317e3973060756959627a107d';
let compatibility;
export async function checkCompatibility() {
  compatibility ??= readFile(cli).then(bytes => {
    if (createHash('sha256').update(bytes).digest('hex') !== CLI_SHA256)
      throw new AppError('Wallet component changed. Reinstall the locked dependencies with npm ci.', 503, 'WALLET_VERSION');
    return true;
  }).catch(error => { compatibility = null; throw error; });
  return compatibility;
}
export const writePrivate = async (file, value) => {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(tmp, file);
};
export function validPairing(data, now = Date.now()) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,159}$/.test(data?.qrCodeId || '')) return false;
  try {
    const u = new URL(data.urlForWeb);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      ((u.hostname === 'web3.binance.com' && u.pathname.endsWith('/agent-login')) ||
       (u.hostname === 'app.binance.com' && /^\/uni-qr\/[a-zA-Z0-9_-]+$/.test(u.pathname))) &&
      typeof data.pairingCode === 'string' && data.pairingCode.length > 0 && data.pairingCode.length < 100 &&
      Number(data.expireAt) > now;
  } catch { return false; }
}
function allowed(args) {
  return (args.length === 2 && ((args[0] === 'wallet' && ['status','address','settings'].includes(args[1])) ||
    (args[0] === 'auth' && ['signin','signout'].includes(args[1])))) ||
    (args.length === 4 && args[0] === 'auth' && args[1] === 'verify' && args[2] === '--qrCodeId' && /^[\w-]{8,160}$/.test(args[3])) ||
    (args.length === 4 && args[0] === 'contract-call' && args[1] === 'execute' && args[2] === '--requestId' && /^[\w-]{1,200}$/.test(args[3])) ||
    (args.length === 12 && args[0] === 'contract-call' && args[1] === 'preview' &&
     args[2] === '--binanceChainId' && args[3] === '56' && args[4] === '--from' && /^0x[\da-fA-F]{40}$/.test(args[5]) &&
     args[6] === '--to' && /^0x[\da-fA-F]{40}$/.test(args[7]) && args[8] === '--value' && /^\d{1,78}$/.test(args[9]) &&
     args[10] === '--inputData' && /^0x[\da-fA-F]{8,20000}$/.test(args[11]));
}
export function runWallet(session, args, timeout = 45_000, assertActive = () => {}) {
  if (!allowed(args)) throw new AppError('Unsupported wallet operation.', 400, 'WALLET_COMMAND');
  let child, cancelled = false, settled = false, timer, rejectTask;
  const promise = new Promise((resolve, reject) => {
    rejectTask = reject;
    (async () => {
      await checkCompatibility();
      if (cancelled) throw new Error('CANCELLED');
      assertActive();
      if (!/^[a-f0-9]{64}$/.test(session.secret) || !/^[a-f0-9]{64}$/.test(session.id)) throw new Error('NAMESPACE_REQUIRED');
      const env = {};
      for (const k of ['PATH','LANG','LC_ALL','TMPDIR','TEMP','TMP','SystemRoot','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY'])
        if (process.env[k]) env[k] = process.env[k];
      Object.assign(env, { BINANCE_BAW_DIR: session.dir, BINANCE_INSTANCE_ID: session.secret,
        BIA_KEYCHAIN_SCOPE: session.id, NO_COLOR: '1' });
      child = spawn(process.execPath, ['--import', loader, cli, ...args, '--json'], { cwd: root, env, stdio: ['ignore','pipe','pipe'] });
      let output = '';
      const fail = error => { if (settled) return; settled = true; clearTimeout(timer); child?.kill('SIGTERM'); reject(error); };
      timer = setTimeout(() => fail(new Error('WALLET_TIMEOUT')), timeout);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 2_000_000) fail(new Error('OUTPUT_LIMIT')); });
      child.stderr.on('data', () => {}); // Wallet diagnostics can contain credentials. Never log them.
      child.on('error', () => fail(new Error('WALLET_PROCESS')));
      child.on('close', () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        try { const result = JSON.parse(output.trim());
          if (!result.success) { const e = new Error(String(result.error?.message || 'Wallet request rejected.').slice(0, 300)); e.name = String(result.error?.name || 'WALLET_REJECTED'); e.walletCode = result.error?.code; reject(e); }
          else resolve(result.data);
        } catch { reject(new Error('WALLET_RESPONSE')); }
      });
    })().catch(error => { if (!settled) { settled = true; reject(error); } });
  });
  return { promise, cancel() { cancelled = true; clearTimeout(timer); child?.kill('SIGTERM'); if (!settled) { settled = true; rejectTask(new Error('CANCELLED')); } } };
}
export function walletError(error) {
  const code = String(error?.name || '');
  if (/RISK|BLOCK/.test(code)) return 'Binance blocked this transaction under the wallet security policy.';
  if (/INSUFFICIENT/.test(code)) return 'Insufficient balance or gas in your Agentic Wallet.';
  if (/DEV_MODE|LIMIT|QUOTA/.test(code)) return 'Check Developer Mode, its expiry and daily limit in the Binance App.';
  if (/EXPIRED|REJECTED|TIMEOUT|UNAUTHORIZED|NOT_LOGGED/.test(code)) return 'The wallet request expired or was rejected. Check the Binance App.';
  return `The Binance wallet request could not be completed (${code || 'no code'}). Check your connection and wallet settings.`;
}
export function walletView(s) {
  return { status: s.status, address: s.address, chainId: 56, provider: 'Binance Agentic Wallet',
    developer: s.developer || null, error: s.error,
    pairing: s.pairing ? { url: s.pairing.urlForWeb, code: s.pairing.pairingCode, expiresAt: Number(s.pairing.expireAt) } : null };
}
export class WalletService {
  constructor({ dataDir, runner = runWallet, now = Date.now }) { this.dataDir = dataDir; this.runner = runner; this.now = now; this.sessions = new Map(); }
  get(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new AppError('Invalid account session.', 401);
    if (!this.sessions.has(key)) this.sessions.set(key, this.load(key).catch(error => { this.sessions.delete(key); throw error; }));
    return this.sessions.get(key);
  }
  async load(key) {
    const dir = join(this.dataDir, 'wallets', key);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let secret;
    try { secret = await readFile(join(dir, 'instance.key'), 'utf8'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; secret = randomBytes(32).toString('hex'); await writeFile(join(dir, 'instance.key'), secret, { mode: 0o600, flag: 'wx' }); }
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new AppError('Invalid wallet storage.', 503);
    let control = { active: false, generation: randomBytes(16).toString('hex') };
    try { control = JSON.parse(await readFile(join(dir, 'control.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { id: key, dir, secret, control, status: 'UNCONNECTED', address: null, pairing: null, error: null,
      developer: null, checked: 0, check: null, verify: null, busy: false };
  }
  persist(s) { return writePrivate(join(s.dir, 'control.json'), s.control); }
  assert(s, generation) { if (!s.control.active || s.control.generation !== generation) throw new AppError('Wallet authorization was revoked. Connect again.', 403, 'WALLET_REVOKED'); }
  async exclusive(s, fn) {
    if (s.busy || s.revoking) throw new AppError('Another wallet operation is in progress.', 409, 'WALLET_BUSY');
    s.busy = true;
    try { return await fn(); } finally { s.busy = false; }
  }
  async refresh(s, force = false) {
    if (!s.control.active || s.status === 'CONNECTING' || (s.busy && !force)) return walletView(s);
    if (s.check) { await s.check; if (!force) return walletView(s); }
    if (!force && this.now() - s.checked < 10_000) return walletView(s);
    const generation = s.control.generation;
    s.check = (async () => {
      try {
        const result = await this.runner(s, ['wallet','status']).promise;
        this.assert(s, generation);
        if (result.status !== 'CONNECTED') { s.status = 'UNCONNECTED'; s.address = null; s.developer = null; return; }
        const addresses = await this.runner(s, ['wallet','address']).promise;
        const settings = await this.runner(s, ['wallet','settings']).promise;
        this.assert(s, generation);
        const addr = addresses.addresses?.find(a => String(a.binanceChainId) === '56')?.address;
        if (!/^0x[\da-fA-F]{40}$/.test(addr || '')) throw new Error('BSC_ADDRESS');
        s.address = addr; s.status = 'CONNECTED'; s.error = null;
        s.developer = { enabled: settings.devMode?.enabled === true, expiresAt: walletExpiry(settings.devMode?.expiresAt),
          dailyLimit: settings.devMode?.dailyLimit ?? null, used: settings.developerModeQuotaUsed ?? null,
          date: settings.developerModeQuotaDate ?? null, balanceExceeded: settings.devMode?.balanceExceeded === true };
      } catch (e) {
        if (s.control.generation === generation) { s.status = 'UNCONNECTED'; s.address = null; s.developer = null; s.error = walletError(e); }
      } finally { s.checked = this.now(); }
    })();
    try { await s.check; return walletView(s); } finally { s.check = null; }
  }
  async ready(s) {
    const generation = s.control.generation;
    await this.refresh(s, true); this.assert(s, generation);
    if (s.status !== 'CONNECTED' || !s.address) throw new AppError('Connect your Binance Agentic Wallet first.', 401, 'WALLET_REQUIRED');
    const blocker = developerBlocker(s.developer, this.now());
    const messages = {
      DEVELOPER_MODE: 'Enable Developer Mode in the Binance App, then refresh wallet status.',
      DEVELOPER_EXPIRY_UNKNOWN: 'The wallet authorization expiry is unavailable. Refresh wallet status before continuing.',
      DEVELOPER_EXPIRED: 'Developer Mode authorization has expired. Renew it in the Binance App, then refresh wallet status.',
      DEVELOPER_QUOTA: 'Developer Mode balance or daily quota restriction. Review settings in the Binance App.'
    };
    if (blocker) throw new AppError(messages[blocker], 403, blocker);
    return { address: s.address, generation };
  }
  async connect(s) {
    return this.exclusive(s, async () => {
      if (s.check) await s.check;
      if (s.pairing && Number(s.pairing.expireAt) > this.now()) return walletView(s);
      s.verify?.cancel(); s.control = { active: true, generation: randomBytes(16).toString('hex') };
      const generation = s.control.generation;
      await this.persist(s); s.error = null; s.pairing = null;
      try {
        const result = await this.runner(s, ['auth','signin'], 45_000, () => this.assert(s, generation)).promise;
        this.assert(s, generation);
        if (result.status === 'ALREADY_CONNECTED') { s.status = 'UNCONNECTED'; return this.refresh(s, true); }
        if (!validPairing(result, this.now())) throw new Error('PAIRING_RESPONSE');
        s.status = 'CONNECTING'; s.address = null; s.developer = null; s.pairing = result;
        const verify = this.runner(s, ['auth','verify','--qrCodeId', result.qrCodeId], Math.min(340_000, Number(result.expireAt) - this.now() + 15_000), () => this.assert(s, generation));
        s.verify = verify;
        verify.promise.then(async () => {
          this.assert(s, generation); s.pairing = null; s.status = 'UNCONNECTED'; await this.refresh(s, true);
        }).catch(e => {
          if (s.control.generation === generation) { s.pairing = null; s.status = 'UNCONNECTED'; s.error = walletError(e); }
        }).finally(() => { if (s.control.generation === generation) s.verify = null; });
        return walletView(s);
      } catch (e) {
        if (s.control.generation === generation) { s.status = 'UNCONNECTED'; s.error = walletError(e); }
        throw new AppError(walletError(e), 502, 'WALLET_CONNECT');
      }
    });
  }
  async disconnect(s) {
    // Revocation invalidates pending intents even while a CLI operation is running.
    s.revoking = true;
    s.control = { active: false, generation: randomBytes(16).toString('hex') };
    s.verify?.cancel(); s.verify = null; s.status = 'UNCONNECTED'; s.address = null; s.developer = null; s.pairing = null; s.error = null;
    await this.persist(s);
    try { await this.runner(s, ['auth','signout']).promise; }
    catch { s.error = 'BIA access is revoked. Also check the authorization status in the Binance App.'; }
    finally { s.revoking = false; }
    return walletView(s);
  }
  async close() { for (const promise of this.sessions.values()) { const s = await promise; s.verify?.cancel(); } }
}
