// MDTN-A1 1.0 12823B20 xBb487QEq8a1rXc6NqawslG917RvgI6p5BO1e0Qan4i2GMTMo29k6QTXEG23SvtKPEApu5smDyxh0ta8B3IHCA
/**
 * md-tiny · 本地服务
 *
 * 职责：把编辑器网页与 Windows 文件系统连起来，使「双击 .md」可以直接读写本机文件。
 *
 * 安全设计（重要）：
 *  1. 只监听 127.0.0.1，不对外网暴露
 *  2. 校验 Host 头，阻断 DNS rebinding 攻击（恶意域名解析到 127.0.0.1）
 *  3. 所有 /api/* 接口强制 Token 鉴权（Token 由安装脚本随机生成，存于 config.json）
 *  4. 静态资源仅从 web/ 目录提供，阻断路径穿越
 *  5. 请求体大小上限 32MB
 *
 * 生命周期：无请求 30 分钟后自动退出；下次双击时由 launcher.js 按需拉起。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const ERR_LOG = path.join(ROOT, 'server-error.log');
const ACCESS_LOG = path.join(ROOT, 'access.log');
const VERSION = '1.0';

const MAX_BODY = 32 * 1024 * 1024;
const IDLE_EXIT_MS = 30 * 60 * 1000;
const MD_RE = /\.(md|markdown|mdown|txt)$/i;

// ---------------------------------------------------------------- 配置

const { loadConfig } = require('./config');
const CFG = loadConfig();

// 端口：默认取 config.json 里的值。允许用环境变量临时覆盖 —— 自测脚本据此跑在独立端口上，
// 不会撞上用户本机已经安装并正在运行的实例（否则测试会连到那个实例，测的就不是这份代码）。
const PORT = Number(process.env.MD_EDITOR_PORT) || CFG.port;

// 记录每个文件读取时的 BOM 状态，写回时保持一致（保证"源码零改动"）
const bomState = new Map();

function logErr(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
  try { fs.appendFileSync(ERR_LOG, line, 'utf8'); } catch (e) { /* ignore */ }
}

// 访问日志：排查「双击后浏览器没反应」时先看这个文件
//   有 /api/ping 行        -> launcher 跑到了这里，服务是活的
//   有 GET / 行            -> 浏览器确实把页面拉起来了
//   只有 ping 没有 /       -> 卡在「唤起默认浏览器」这一步
function logAccess(line) {
  try {
    // 简单自保：超过 2MB 直接重来，避免长期运行把盘写满
    if (fs.statSync(ACCESS_LOG).size > 2 * 1024 * 1024) fs.writeFileSync(ACCESS_LOG, '', 'utf8');
  } catch (e) { /* 文件还不存在 */ }
  try { fs.appendFileSync(ACCESS_LOG, '[' + new Date().toISOString() + '] ' + line + '\n', 'utf8'); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- 工具

function hostAllowed(req) {
  const h = String(req.headers.host || '');
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(h);
}

function tokenAllowed(req, url) {
  const raw = req.headers['x-md-token'] || url.searchParams.get('token');
  if (!raw || typeof raw !== 'string') return false;
  const a = Buffer.from(raw, 'utf8');
  const b = Buffer.from(CFG.token, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体超过上限')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// ---------------------------------------------------------------- API

async function apiFileRead(url) {
  const p = url.searchParams.get('path');
  if (!p) return { code: 400, body: { ok: false, error: '缺少 path 参数' } };
  const abs = path.resolve(p);
  let stat;
  try { stat = await fsp.stat(abs); } catch (e) {
    return { code: 404, body: { ok: false, error: '文件不存在：' + abs } };
  }
  if (!stat.isFile()) return { code: 400, body: { ok: false, error: '不是文件：' + abs } };

  let raw;
  try { raw = await fsp.readFile(abs); } catch (e) {
    return { code: 500, body: { ok: false, error: '读取失败：' + e.message } };
  }
  let text = raw.toString('utf8');
  let bom = false;
  if (text.charCodeAt(0) === 0xfeff) { bom = true; text = text.slice(1); }
  bomState.set(abs.toLowerCase(), bom);

  return {
    code: 200,
    body: { ok: true, path: abs, name: path.basename(abs), text, mtime: stat.mtimeMs, size: stat.size, bom }
  };
}

async function apiFileWrite(body) {
  const p = body && body.path;
  const text = body && body.text;
  if (!p || typeof text !== 'string') {
    return { code: 400, body: { ok: false, error: '缺少 path 或 text' } };
  }
  const abs = path.resolve(p);
  const dir = path.dirname(abs);
  try { await fsp.access(dir); } catch (e) {
    return { code: 400, body: { ok: false, error: '目录不存在：' + dir } };
  }

  // 外部修改冲突检测：调用方带上读取时的 mtime，若磁盘已变化则拒绝
  const key = abs.toLowerCase();
  if (body.baseMtime) {
    try {
      const st = await fsp.stat(abs);
      if (Math.abs(st.mtimeMs - Number(body.baseMtime)) > 1) {
        return {
          code: 409,
          body: { ok: false, code: 'CONFLICT', error: '文件已被外部修改', mtime: st.mtimeMs }
        };
      }
    } catch (e) { /* 文件不存在 -> 视为新建，直接写 */ }
  }

  const bom = bomState.get(key) || body.bom === true;
  const payload = Buffer.from((bom ? '\ufeff' : '') + text, 'utf8');

  // 原子写：先写临时文件，再改名覆盖，避免写入中断导致文件损坏
  const tmp = path.join(dir, '.' + path.basename(abs) + '.mdedit-' + process.pid + '.tmp');
  try {
    await fsp.writeFile(tmp, payload);
    await fsp.rename(tmp, abs);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch (e2) { /* ignore */ }
    return { code: 500, body: { ok: false, error: '写入失败：' + e.message } };
  }

  let mtime = 0, size = payload.length;
  try { const st = await fsp.stat(abs); mtime = st.mtimeMs; size = st.size; } catch (e) { /* ignore */ }
  return { code: 200, body: { ok: true, path: abs, mtime, size } };
}

async function apiList(url) {
  const dir = url.searchParams.get('dir');
  if (!dir) return { code: 400, body: { ok: false, error: '缺少 dir 参数' } };
  const rootAbs = path.resolve(dir);
  const maxDepth = Math.min(Number(url.searchParams.get('depth')) || 4, 8);
  const out = [];
  const LIMIT = 3000;

  async function walk(d, depth) {
    if (depth > maxDepth || out.length >= LIMIT) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      if (out.length >= LIMIT) return;
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (MD_RE.test(ent.name)) {
        out.push({ name: ent.name, path: full, rel: path.relative(rootAbs, full).split(path.sep).join('/') });
      }
    }
  }
  await walk(rootAbs, 1);
  out.sort((a, b) => a.rel.localeCompare(b.rel, 'zh'));
  return { code: 200, body: { ok: true, dir: rootAbs, files: out } };
}

// ---------------------------------------------------------------- 静态资源

async function serveStatic(url, res) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(WEB_DIR, rel);
  if (!target.startsWith(WEB_DIR)) { res.writeHead(403).end('forbidden'); return; }

  let st;
  try { st = await fsp.stat(target); } catch (e) { res.writeHead(404).end('not found'); return; }
  if (!st.isFile()) { res.writeHead(404).end('not found'); return; }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(target).pipe(res);
}

// ---------------------------------------------------------------- 服务器

let lastActivity = Date.now();

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  // 状态码要等响应结束才知道，所以挂到 finish 上。
  // 排查「服务起来了但文件打不开」时，access.log 里一眼能看出是 403（Token 不匹配）、
  // 404（路径不对）还是 500，不必再去猜。
  res.on('finish', () => {
    try { logAccess(req.method + ' ' + req.url + ' -> ' + res.statusCode); } catch (e) { /* ignore */ }
  });
  try {
    if (!hostAllowed(req)) { res.writeHead(403).end('forbidden host'); return; }

    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (p === '/api/ping') {
      // 自我识别接口。同一台机器上可能同时存在多份副本（例如解压目录 + 安装目录），
      // 每份都有自己的 config.json / Token，但都会用同一个端口。
      // launcher 在「复用已在运行的服务」之前必须先问一句：你认不认我这个 Token？
      //   mine=true  -> 是同一份代码、同一份配置，直接复用
      //   mine=false -> 端口上坐着的是别人的实例；若不复用而硬上，
      //                 页面由对方提供、API 却带我们的 Token，会全部 403 → 白屏
      const mine = tokenAllowed(req, url);
      sendJSON(res, 200, {
        ok: true, app: 'md-tiny-win', version: VERSION,
        port: PORT, root: ROOT, mine: mine
      });
      return;
    }

    if (p.startsWith('/api/')) {
      if (!tokenAllowed(req, url)) { sendJSON(res, 403, { ok: false, error: 'Token 无效或缺失' }); return; }

      if (p === '/api/file' && req.method === 'GET') {
        const r = await apiFileRead(url); sendJSON(res, r.code, r.body); return;
      }
      if (p === '/api/file' && req.method === 'POST') {
        const raw = await readBody(req);
        let body;
        try { body = JSON.parse(raw.toString('utf8')); } catch (e) {
          sendJSON(res, 400, { ok: false, error: 'JSON 解析失败' }); return;
        }
        const r = await apiFileWrite(body); sendJSON(res, r.code, r.body); return;
      }
      if (p === '/api/list' && req.method === 'GET') {
        const r = await apiList(url); sendJSON(res, r.code, r.body); return;
      }
      sendJSON(res, 404, { ok: false, error: '未知接口：' + p });
      return;
    }

    if (req.method !== 'GET') { res.writeHead(405).end('method not allowed'); return; }
    await serveStatic(url, res);
  } catch (e) {
    logErr(String(e && e.stack || e));
    try { sendJSON(res, 500, { ok: false, error: String(e && e.message || e) }); } catch (e2) { /* ignore */ }
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // 已有实例在跑（launcher 会先 ping，这里属于并发启动竞态）——静默退出
    process.exit(0);
  }
  logErr('server error: ' + String(e && e.stack || e));
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[md-tiny-win] listening on http://127.0.0.1:' + PORT);
});

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_EXIT_MS) {
    console.log('[md-tiny-win] idle timeout, exiting');
    process.exit(0);
  }
}, 60 * 1000).unref();

process.on('uncaughtException', (e) => { logErr('uncaught: ' + String(e && e.stack || e)); });
