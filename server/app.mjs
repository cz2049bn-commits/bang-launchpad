import{ChartService}from'./charts.mjs';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Accounts } from './accounts.mjs';
import { AppError } from '../shared/errors.mjs';
import { LiveService } from './live/service.mjs';
import { AdminService, ADMIN_COOKIE } from './admin.mjs';
import { TerminalService } from './terminal.mjs';
import { integrationManifest } from './integration.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOKIE = 'bn_launchpad_session';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.hdr': 'application/octet-stream', '.md': 'text/plain; charset=utf-8', '.zip': 'application/zip' };

function respond(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function jsonBody(req, limit = 16_384) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new AppError('请使用 JSON 请求', 415, 'JSON_REQUIRED');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError('请求内容过大', 413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('JSON 格式无效'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('请求内容必须是对象');
  return body;
}

function decodePath(raw) {
  let decoded;
  try { decoded = decodeURIComponent(raw.split('?')[0]); }
  catch { throw new AppError('路径编码无效'); }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') ||
      decoded.split('/').some(part => part === '..' || part === '.') || decoded.includes('%'))
    throw new AppError('路径无效', 400, 'INVALID_PATH');
  return decoded;
}

export async function createApp({ dataDir = path.join(ROOT, 'data'), distDir = path.join(ROOT, 'dist'),
  now, logger = console, liveService, adminService } = {}) {
  const accounts = await new Accounts({ dataDir, now }).init();
  const live = liveService || new LiveService({ dataDir });
  const admin = adminService || await new AdminService({dataDir, client: live.chain?.client}).init();
  const terminal = new TerminalService({market:live.market,client:live.chain?.client,dataDir});
  const charts=new ChartService({terminal});
  const rates = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const port = req.socket.localPort;
      const host = req.headers.host;
      const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`,
        ...(process.env.PUBLIC_HOSTS ?? '').split(',').map(item => item.trim()).filter(Boolean)]);
      if (!allowed.has(host))
        throw new AppError('不允许的主机名', 403, 'INVALID_HOST');
      const pathname = decodePath(req.url ?? '/');
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new AppError('不支持的请求方式', 405, 'METHOD_NOT_ALLOWED');
      if (pathname.startsWith('/api/')) {
        if (req.method === 'HEAD') throw new AppError('不支持的请求方式', 405, 'METHOD_NOT_ALLOWED');
        if(pathname.startsWith('/api/assets/')&&req.method==='GET'){
          const f=pathname.slice('/api/assets/'.length);if(!/^[a-f0-9]{64}\.(png|json)$/.test(f))throw new AppError('Asset not found.',404);
          let bytes;try{bytes=await readFile(path.join(dataDir,'public-assets',f))}catch{throw new AppError('Asset not found.',404)}
          res.writeHead(200,{'Content-Type':f.endsWith('.png')?'image/png':'application/json','Cache-Control':'public, max-age=31536000, immutable'});return res.end(bytes);
        }
        if(pathname==='/api/terminal/chart'&&req.method==='GET')return respond(res,200,await charts.get(new URL(req.url,'http://localhost').searchParams));
        if(pathname==='/api/native/status'&&req.method==='GET')return respond(res,200,await live.native.status());
        if(pathname==='/api/native/target'&&req.method==='GET'){const p=new URL(req.url,'http://localhost').searchParams;return respond(res,200,await live.native.target(p.get('quote'),p.get('bnb')));}
        if (pathname === '/api/integration' && req.method === 'GET') return respond(res,200,integrationManifest());
        if(pathname.startsWith('/api/terminal/')){
          if(req.method!=='GET')throw new AppError('Read-only terminal endpoint',405);
          return respond(res,200,await terminal.handle(pathname,new URL(req.url,'http://localhost').searchParams));
        }
        const secure = host !== `127.0.0.1:${port}` && host !== `localhost:${port}`;
        const expectedOrigin = `${secure ? 'https' : 'http'}://${host}`;
        if (req.method === 'POST' && req.headers.origin !== expectedOrigin)
          throw new AppError('请求来源验证失败', 403, 'ORIGIN_REJECTED');
        const requestCookies = req.headers.cookie?.split(';').map(part => part.trim()) ?? [];
        const adminCookie = requestCookies.find(part => part.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length + 1);
        if (pathname === '/api/bang' && req.method === 'GET') return respond(res,200,await admin.publicStatus());
        if (pathname.startsWith('/api/admin/')) {
          if (req.method === 'POST' && pathname === '/api/admin/login') {
            const body = await jsonBody(req);const token = await admin.login(body.password);
            return respond(res,200,{authenticated:true},{'Set-Cookie':admin.cookie(token,secure)});
          }
          if (req.method === 'GET' && pathname === '/api/admin/session') return respond(res,200,{authenticated:admin.authorized(adminCookie)});
          admin.require(adminCookie);
          if (req.method === 'GET' && pathname === '/api/admin/config') return respond(res,200,{config:admin.config,status:await admin.publicStatus()});
          if (req.method === 'POST' && pathname === '/api/admin/config') return respond(res,200,await admin.save(adminCookie,await jsonBody(req)));
          if (req.method === 'POST' && pathname === '/api/admin/logout') {await jsonBody(req);admin.logout(adminCookie);return respond(res,200,{authenticated:false},{'Set-Cookie':admin.cookie('',secure,true)});}
          throw new AppError('Admin route not found.',404,'NOT_FOUND');
        }
        const rawCookie = requestCookies.find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
        const { key, cookie } = await accounts.session(rawCookie);
        if (cookie) res.setHeader('Set-Cookie', `${COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? '; Secure' : ''}`);
        if (req.method === 'POST') {
          const time = Date.now(), bucket = rates.get(key);
          if (!bucket || time > bucket.until) rates.set(key, { until: time + 60_000, count: 1 });
          else if (++bucket.count > 120) throw new AppError('操作过于频繁，请稍后重试', 429, 'RATE_LIMIT');
          if (rates.size > 10_000) for (const [id, row] of rates) if (row.until < time) rates.delete(id);
        }
        if (pathname.startsWith('/api/live/')) {
          const body = req.method === 'POST' ? await jsonBody(req, pathname === '/api/live/metadata' ? 2_900_000 : 16_384) : {};
          try { return respond(res, 200, await live.handle(req.method, pathname, key, body, new URL(req.url, `http://${host}`).searchParams)); }
          catch (e) { if (e instanceof AppError) throw e; throw new AppError('Live network request failed. Check your RPC connection and try again.', 502, 'LIVE_NETWORK'); }
        }
        if (req.method === 'GET') {
          if (pathname === '/api/session') return respond(res, 200, {mode:'live',chainId:56,session:accounts.view(key)});
          if (pathname === '/api/state') return respond(res, 200, {...await live.market.list(),session:accounts.view(key)});
          if (pathname === '/api/market') return respond(res, 200, await live.market.list());
          if (pathname === '/api/service') return respond(res, 200, await live.status(key));
          if (pathname === '/api/export') return respond(res, 200, {product:'BANG',mode:'live',chainId:56,provider:'Binance Agentic Wallet',protocol:await (live.native?live.native.status():live.chain.status()),session:accounts.view(key)}, {
            'Content-Disposition': 'attachment; filename="bang-mainnet-config.json"' });
          throw new AppError('API route not found.', 404, 'NOT_FOUND');
        }
        await jsonBody(req);
        // Retired endpoints cannot create synthetic balances, assets, fills or execution permissions.
        if (['/api/quote','/api/trade','/api/agents','/api/policy','/api/policy/revoke','/api/service/config','/api/service/test','/api/execute','/api/service/execute','/api/wallet/connect','/api/sign'].includes(pathname))
          throw new AppError('This endpoint has been retired. Use the real wallet transaction preview and confirmation flow.', 410, 'ENDPOINT_RETIRED');
        throw new AppError('接口不存在', 404, 'NOT_FOUND');
      }
      if (req.method === 'POST') throw new AppError('不支持的请求方式', 405, 'METHOD_NOT_ALLOWED');
      const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (rel.split('/').some(part => part.startsWith('.')))
        throw new AppError('文件不存在', 404, 'NOT_FOUND');
      let file = path.join(distDir, rel);
      try {
        if (!(await stat(file)).isFile()) throw Object.assign(new Error(), { code: 'ENOENT' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (path.extname(rel)) throw new AppError('文件不存在', 404, 'NOT_FOUND');
        file = path.join(distDir, 'index.html');
      }
      let content;
      try { content = await readFile(file); }
      catch (error) {
        if (error.code === 'ENOENT') throw new AppError('尚未构建前端，请先运行 npm run build', 503, 'BUILD_REQUIRED');
        throw error;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'Content-Length': content.length, 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!(error instanceof AppError)) logger.error('Local API failure:', error.message);
      if (!res.headersSent) respond(res, error.status ?? 500, { error: error instanceof AppError ? error.message : '本地服务异常，请重试',
        code: error.code ?? 'INTERNAL_ERROR', ...(error.details ? { details: error.details } : {}) });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, accounts, live, listen: (port = 5210) => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', () => {
      server.off('error', reject); resolve(`http://127.0.0.1:${server.address().port}`);
    });
  }), close: async () => { await live.close(); return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 5210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口');
  const app = await createApp();
  console.log(`BANG Launchpad: ${await app.listen(port)}`);
  console.log('BNB mainnet only. EVM issuance is open. Inner buys require Agent ID; web trading uses the user’s paired Agentic Wallet.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
