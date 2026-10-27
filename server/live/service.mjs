import {NativeLaunchpad} from './native.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../shared/errors.mjs';
import { WalletService, walletView, walletError, writePrivate } from './wallet.mjs';
import { LaunchMarket } from './market.mjs';
import { ChainService, PORTAL, cid } from './chain.mjs';
import { ExternalTrading } from './external.mjs';
import { QuickTrading } from './quick.mjs';

const unresolved = new Set(['SUBMITTING','UNKNOWN','PENDING_CONFIRMATION','BROADCASTED','CONFIRMING','RECEIPT_REVIEW']);
export function publicIntent(i) {
  return { id: i.id, status: i.status, kind: i.tx.kind, chainId: 56, from: i.tx.from, to: i.tx.to,
    valueWei: i.tx.value, data: i.tx.data, fingerprint: i.fingerprint, summary: i.tx.summary,
    simulation: i.simulation, review: i.review, createdAt: i.createdAt, expiresAt: i.expiresAt,
    txHash: i.result?.txHash || null, orderId: i.result?.orderId || null,
    confirmations: i.result?.confirmations || 0, token: i.result?.token || null,
    message: i.message || null, block: i.result?.block || null, gasCost: i.result?.gasCost || null,
    received: i.result?.received || null };
}
export class LiveService {
  constructor({ dataDir, wallet, chain, external, native, now = Date.now, fetcher = fetch } = {}) {
    this.wallet = wallet || new WalletService({ dataDir }); this.chain = chain || new ChainService();
    this.legacyMarket = new LaunchMarket({dataDir:dataDir||this.wallet.dataDir,chain:this.chain,now});
    this.native=native===null?null:native||(this.chain.client?new NativeLaunchpad({client:this.chain.client,dataDir:dataDir||this.wallet.dataDir,now}):null);
    this.market=this.native||this.legacyMarket;
    this.external = external || new ExternalTrading({client:this.chain.client,native:this.native,now});
    this.now = now; this.fetcher = fetcher; this.metadataBusy = new Set();
    this.quick=new QuickTrading(this);
  }
  async read(s, id) {
    if (!/^[a-f0-9]{32}$/.test(id || '')) throw new AppError('Invalid operation ID.');
    try { return JSON.parse(await readFile(join(s.dir, 'operations', `${id}.json`), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') throw new AppError('Operation not found for this account.', 404); throw e; }
  }
  async save(s, i) { await mkdir(join(s.dir, 'operations'), { recursive: true, mode: 0o700 }); await writePrivate(join(s.dir, 'operations', `${i.id}.json`), i); }
  async history(s) {
    const files = await readdir(join(s.dir, 'operations')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const rows = await Promise.all(files.filter(f => /^[a-f0-9]{32}\.json$/.test(f)).map(f => this.read(s, f.slice(0,32))));
    return rows.sort((a,b) => b.createdAt - a.createdAt);
  }
  async status(key) {
    const s = await this.wallet.get(key);
    const [wallet, protocol] = await Promise.all([
      this.wallet.refresh(s), (this.native?this.native.status():this.chain.status()).catch(() => ({ ready: false, chainId: 56, portal: PORTAL, error: 'BNB RPC is temporarily unavailable.' }))]);
    let rows=await this.history(s);
    for(const i of rows.filter(i=>unresolved.has(i.status)&&i.result?.txHash).slice(0,4)){try{await this.operation(key,i.id)}catch{}}
    rows=await this.history(s);
    return { wallet, protocol, operations: rows.slice(0,20).map(publicIntent) };
  }
  async metadata(key, body) {
    if (body.publish !== true) throw new AppError('Confirm public metadata publication.');
    if (this.metadataBusy.has(key)) throw new AppError('A metadata upload is already in progress.', 409);
    const s = await this.wallet.get(key), { address } = await this.wallet.ready(s);
    if (!['image/png','image/jpeg'].includes(body.type) || typeof body.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image)) throw new AppError('Choose a PNG or JPEG image.');
    const image = Buffer.from(body.image, 'base64');
    if (image.length < 16 || image.length > 2 * 1024 * 1024) throw new AppError('Use an image smaller than 2 MB.');
    if (body.type === 'image/png' ? image.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' : image.subarray(0,3).toString('hex') !== 'ffd8ff') throw new AppError('The image content does not match its file type.');
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description || description.length > 1000) throw new AppError('Write a description of 1–1000 characters.');
    const meta = { description, creator: address };
    for (const field of ['website','twitter','telegram']) {
      if (!body[field]) { meta[field] = null; continue; }
      try { const u = new URL(body[field]); if (u.protocol !== 'https:' || u.username || u.password || u.href.length > 300) throw Error(); meta[field] = u.href; }
      catch { throw new AppError('Social and website links must be valid HTTPS URLs.'); }
    }
    const form = new FormData();
    form.set('operations', JSON.stringify({ query: 'mutation Create($file: Upload!, $meta: MetadataInput!) { create(file: $file, meta: $meta) }', variables: { file: null, meta } }));
    form.set('map', JSON.stringify({ 0: ['variables.file'] }));
    form.set('0', new Blob([image], { type: body.type }), body.type === 'image/png' ? 'agent.png' : 'agent.jpg');
    this.metadataBusy.add(key);
    try {
      const response = await this.fetcher('https://funcs.flap.sh/api/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(45_000) });
      const result = await response.json();
      if (!response.ok || result.errors?.length) throw Error();
      const metadataCid = cid(result.data?.create);
      return { metadataCid, url: `https://flap.mypinata.cloud/ipfs/${metadataCid}` };
    } catch { throw new AppError('Flap metadata upload was not confirmed. Check connectivity before uploading again; the first upload may already be public.', 502, 'METADATA_UPLOAD'); }
    finally { this.metadataBusy.delete(key); }
  }
  async preview(key, body) {
    const s = await this.wallet.get(key);
    return this.wallet.exclusive(s, async () => {
      const rows = await this.history(s);
      if (rows.some(i => unresolved.has(i.status))) throw new AppError('Resolve the pending operation in your transaction history before preparing another.', 409, 'OPERATION_PENDING');
      if (rows.length >= 200) throw new AppError('This local account has reached its operation history limit. Archive it before continuing.', 409);
      const { address, generation } = await this.wallet.ready(s);
      if(body.source && !['bang','gang','openfour'].includes(body.source))throw new AppError('Unsupported market source.');
      const external=['gang','openfour'].includes(body.source)||(body.source==='bang'&&!!this.native);
      if(external&&body.source!=='bang'&&body.kind==='launch')throw new AppError('External token creation is not supported here.');
      if(!external&&body.kind!=='launch')await this.market.require(body.token,{fresh:true});
      const tx = body.kind==='launch'&&this.native ? await this.native.launch(body,address) : external ? await this.external.trade(body,address) : body.kind==='launch' ? await this.chain.launch(body,address) : await this.chain.trade(body,address);
      const simulation = await this.chain.simulate(tx);
      this.wallet.assert(s, generation);
      let result;
      try { result = await this.wallet.runner(s, ['contract-call','preview','--binanceChainId','56','--from',address,
        '--to',tx.to,'--value',tx.value,'--inputData',tx.data], 60_000, () => this.wallet.assert(s, generation)).promise; }
      catch (e) {
        const detail = String(e?.message || '').replace(/^Wallet request rejected\.?\s*/, '').trim();
        throw new AppError(detail && !/^wallet request rejected\.?$/i.test(detail) ? detail : walletError(e), 422, 'WALLET_PREVIEW');
      }
      this.wallet.assert(s, generation);
      if (!/^[\w-]{1,200}$/.test(result?.requestId || '') || !/^0+$/.test(String(result.simulationResult?.simulationCode || '')) ||
        result.simulationResult?.simulationErrorDetail || !Number.isFinite(Number(result.expiresAt)))
        throw new AppError('The wallet did not return a successful, executable simulation.', 422, 'PREVIEW_REJECTED');
      const createdAt = this.now(), expiresAt = Math.min(Number(result.expiresAt), createdAt + (tx.kind === 'launch' ? 180_000 : 45_000));
      if (expiresAt <= createdAt) throw new AppError('The wallet preview has already expired.');
      const i = { id: randomBytes(16).toString('hex'), status: 'PREVIEW', owner: key, generation, tx, simulation,
        requestId: result.requestId, createdAt, expiresAt,
        fingerprint: createHash('sha256').update(JSON.stringify({ chainId: 56, ...tx, generation })).digest('hex'),
        review: { parsedTx: result.parsedTx, simulationResult: result.simulationResult, risks: result.risks,
          authorityChanges: result.authorityChanges || [], tokenInfos: result.tokenInfos || {}, requireConfirmation: result.requireConfirmation === true } };
      await this.save(s, i); return publicIntent(i);
    });
  }
  async execute(key, body, authorization = null) {
    const s = await this.wallet.get(key);
    return this.wallet.exclusive(s, async () => {
      const i = await this.read(s, body.id);
      if(i.evm)throw new AppError('Sign this launch in your own EVM wallet.',403);
      if (i.owner !== key) throw new AppError('Operation belongs to another account.', 403);
      if (i.status !== 'PREVIEW') return publicIntent(i); // replay returns the recorded outcome; never resubmits
      if (body.confirm !== true || body.fingerprint !== i.fingerprint) throw new AppError('Review and explicitly confirm this exact transaction.', 403);
      const rows = await this.history(s);
      if (rows.some(x => x.id !== i.id && unresolved.has(x.status))) throw new AppError('Another operation is still pending.', 409);
      this.wallet.assert(s, i.generation);
      const current = await this.wallet.ready(s);
      if (current.address.toLowerCase() !== i.tx.from.toLowerCase()) throw new AppError('The wallet account changed. Prepare a new transaction.', 409, 'ACCOUNT_CHANGED');
      if(i.tx.summary.source)await this.external.validate(i.tx);
      else if(i.tx.kind!=='launch')await this.market.require(i.tx.summary.token,{fresh:true});
      await this.chain.simulate(i.tx);
      this.wallet.assert(s, i.generation);
      if (this.now() >= i.expiresAt) throw new AppError('This preview expired. Request a new preview.', 410, 'PREVIEW_EXPIRED');
      if(authorization)await authorization.check();
      // Durable before execute: a crash or timeout must never cause automatic resubmission.
      i.status = 'SUBMITTING'; await this.save(s, i);
      try {
        const result = await this.wallet.runner(s, ['contract-call','execute','--requestId',i.requestId], 60_000,
          () => {this.wallet.assert(s, i.generation);authorization?.guard();}).promise;
        const hash = /^0x[\da-fA-F]{64}$/.test(result?.txHash || '') ? result.txHash : null;
        i.result = { txHash: hash, orderId: typeof result?.orderId === 'string' ? result.orderId : null };
        i.status = hash ? 'BROADCASTED' : result?.status === 'PENDING_CONFIRMATION' ? 'PENDING_CONFIRMATION' : 'UNKNOWN';
        i.message = i.status === 'PENDING_CONFIRMATION' ? 'Confirm the order in your Binance App, then refresh or attach its transaction hash.' : null;
      } catch {
        i.status = 'UNKNOWN'; i.message = 'Submission result is unknown. Check the Binance App and attach the transaction hash. Do not submit it again.';
      }
      await this.save(s, i); this.market.invalidate(); return publicIntent(i);
    });
  }
  async operation(key, id, hash) {
    const s = await this.wallet.get(key);
    // Receipt reconciliation is serialized with execute so it cannot overwrite a newer result.
    return this.wallet.exclusive(s, async () => {
      const i = await this.read(s, id);
      if (hash && !unresolved.has(i.status)) throw new AppError('This operation does not need transaction recovery.', 409);
      const targetHash = hash || i.result?.txHash;
      if (targetHash && !['CONFIRMED','REVERTED'].includes(i.status)) {
        try {
          const result = await this.chain.receipt(targetHash, i, i.tx.summary.source ? receipt=>this.external.receiptEvidence(receipt,i.tx) : null);
          i.status = result.status; i.result = { ...i.result, ...result }; i.message = null;
          await this.save(s, i); this.market.invalidate();
        } catch (e) { if (e instanceof AppError) throw e;
          if (hash) throw new AppError('This transaction is not yet available from the BNB RPC. Verify the hash and try again.', 404);
        }
      }
      return publicIntent(i);
    });
  }
  async handle(method, pathname, key, body = {}, query = new URLSearchParams()) {
    if(method==='GET'&&pathname==='/api/live/quick')return this.quick.public(key);
    if(method==='GET'&&pathname==='/api/live/quick/job')return this.quick.read(key,query.get('id'));
    if(method==='POST'){
      if(pathname==='/api/live/quick/grant')return this.quick.authorize(key,body);
      if(pathname==='/api/live/quick/revoke')return this.quick.revoke(key);
      if(pathname==='/api/live/quick/trade')return this.quick.start(key,body);
      if(pathname==='/api/live/quick/continue')return this.quick.advance(key,body.id);
      if(pathname==='/api/live/quick/cancel')return this.quick.cancel(key,body.id);
    }
    if (method === 'GET' && pathname === '/api/live/market') return this.market.list();
    if (method === 'GET' && pathname === '/api/live/status') return this.status(key);
    if (method === 'GET' && pathname === '/api/live/terminal-token') {
      const s=await this.wallet.get(key);await this.wallet.refresh(s);
      return this.external.context(query.get('source'),query.get('address'),s.control.active&&s.status==='CONNECTED'?s.address:null);
    }
    if (method === 'GET' && pathname === '/api/live/token') {
      if(this.native){const s=await this.wallet.get(key);await this.wallet.refresh(s);return this.native.context(query.get('address'),s.control.active&&s.status==='CONNECTED'?s.address:null)}
      await this.market.require(query.get('address'));
      const s = await this.wallet.get(key); await this.wallet.refresh(s);
      return this.chain.token(query.get('address'), s.control.active && s.status === 'CONNECTED' ? s.address : null);
    }
    if (method === 'GET' && pathname === '/api/live/operation') return this.operation(key, query.get('id'));
    if (method === 'POST') {
      if (pathname === '/api/live/launch-prepare') return this.prepareEVM(key,body);
      if (pathname === '/api/live/launch-receipt') return this.evmReceipt(key,body);
      if (pathname === '/api/live/connect') return this.wallet.connect(await this.wallet.get(key));
      if (pathname === '/api/live/disconnect') return this.wallet.disconnect(await this.wallet.get(key));
      if (pathname === '/api/live/refresh') return this.wallet.refresh(await this.wallet.get(key), true);
      if (pathname === '/api/live/metadata') return this.native?this.native.metadata(body):this.metadata(key,body);
      if (pathname === '/api/live/preview') return this.preview(key, body);
      if (pathname === '/api/live/execute') return this.execute(key, body);
      if (pathname === '/api/live/receipt') return this.operation(key, body.id, body.txHash);
    }
    throw new AppError('Live API route not found.', 404);
  }
  async prepareEVM(key,body){
    if(!this.native)throw new AppError('Native launchpad unavailable.',503);
    const s=await this.wallet.get(key);
    return this.wallet.exclusive(s,async()=>{
      const tx=await this.native.launch(body,body.from),simulation=await this.chain.simulate(tx),createdAt=this.now();
      const i={id:randomBytes(16).toString('hex'),owner:key,status:'PREVIEW',generation:null,evm:true,tx,simulation,createdAt,expiresAt:createdAt+180000,review:{signing:'Your connected EVM wallet',requireConfirmation:true},fingerprint:createHash('sha256').update(JSON.stringify(tx)).digest('hex')};
      await this.save(s,i);return publicIntent(i);
    });
  }
  async evmReceipt(key,body){
    const s=await this.wallet.get(key),i=await this.read(s,body.id);
    if(!i.evm||i.owner!==key||i.fingerprint!==body.fingerprint)throw new AppError('Launch intent mismatch.',403);
    const result=await this.chain.receipt(body.txHash,i,r=>this.native.receiptEvidence(r,i.tx));
    i.status=result.status;i.result=result;await this.save(s,i);this.market.invalidate();return publicIntent(i);
  }
  close() { return this.wallet.close(); }
}
