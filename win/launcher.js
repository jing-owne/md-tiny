// MDTN-A1 1.0 12823B20 Z60jOp3dGLUQXQlWdsrGSGu5zNzPMYlZ7VaD8iXLp8VNzihZwpPvMzz1EStV0OeNLMFCqPHK4dEAXjRJpbvSDg
/**
 * md-tiny · 启动器
 *
 * 由文件关联唤起：open-md.vbs "%1" -> node launcher.js "<文件路径>"
 * 职责：
 *   1. 若本地服务未运行则按需拉起（隐藏窗口、脱离父进程）
 *   2. 用默认浏览器打开编辑器，并把待打开的文件路径传给编辑器
 *
 * 不写注册表、不常驻：服务 30 分钟无请求自动退出。
 */
'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { loadConfig } = require('./config');

const ROOT = __dirname;
const ERR_LOG = path.join(ROOT, 'server-error.log');
const RUN_LOG = path.join(ROOT, 'launch.log');
const ACCESS_LOG = path.join(ROOT, 'access.log');
const CFG = loadConfig();

// 端口：默认取 config.json。允许用环境变量覆盖，自测脚本据此跑在独立端口上，
// 不会撞上用户本机已安装并正在运行的实例。launcher 与 server 必须看到同一个值，
// 所以 server 是子进程、环境变量天然继承，两边保持一致。
// 用 let：若首选端口被「另一个副本」的服务占着，ensureServer() 会改用别的空闲端口。
let PORT = Number(process.env.MD_EDITOR_PORT) || CFG.port;

// 第一件事就记一笔：排查「双击后什么都没发生」时，先看这个文件有没有新增行
//   有 -> 链路已到 node，问题在后面（服务/浏览器）
//   没有 -> ShellExecute 根本没跑起来（关联、脚本宿主被策略拦、目录被移动）
try {
  fs.appendFileSync(RUN_LOG,
    '[' + new Date().toISOString() + '] launcher entered, argv=' + JSON.stringify(process.argv.slice(2)) + '\n', 'utf8');
} catch (e) { /* ignore */ }

function logErr(msg) {
  try { fs.appendFileSync(ERR_LOG, '[' + new Date().toISOString() + '] launcher: ' + msg + '\n', 'utf8'); } catch (e) { /* ignore */ }
}

function logRun(msg) {
  try { fs.appendFileSync(RUN_LOG, '[' + new Date().toISOString() + '] ' + msg + '\n', 'utf8'); } catch (e) { /* ignore */ }
}

function noop() { /* ignore */ }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 探测某端口上的服务，并确认它是不是「我们自己这一份」。
 *
 * /api/ping 本身不需要 Token，但会如实回答两件事：它属于哪个目录（root）、
 * 认不认我们手上的 Token（mine）。同一台机器上装了两份副本时，这层判断是必须的：
 *   - 只判断「端口有人应答」就复用 → 页面由对方提供、API 带我们的 Token →
 *     服务端一律 403 → 用户看到的就是「服务起来了，文件打不开，是空的」。
 *
 * 返回 { alive, mine, root, version, foreign }
 *   alive 为 false 表示端口上没有任何东西
 *   foreign 为 true 表示端口上有个进程，但它不是本程序（别的软件占着这个端口）
 */
function probe(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1', port, path: '/api/ping', method: 'GET', timeout: timeoutMs,
        headers: { 'X-MD-Token': CFG.token }
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(body); } catch (e) { /* 不是本程序的应答 */ }
          if (!j || j.app !== 'md-tiny-win') { resolve({ alive: true, mine: false, foreign: true }); return; }
          resolve({ alive: true, mine: !!j.mine, root: j.root, version: j.version });
        });
      }
    );
    req.on('error', () => resolve({ alive: false }));
    req.on('timeout', () => { req.destroy(); resolve({ alive: false }); });
    req.end();
  });
}

/** 端口是否空闲 */
function portFree(p) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: p });
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { s.destroy(); } catch (e) { /* ignore */ } resolve(v); };
    s.on('connect', () => fin(false));
    s.on('error', () => fin(true));
    setTimeout(() => fin(true), 700);
  });
}

/** 拉起本副本的服务，并让它监听指定端口 */
function spawnServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, { MD_EDITOR_PORT: String(port) })
  });
  child.unref();
}

/** 等指定端口上出现「属于我们的」服务 */
async function waitServer(port, tries) {
  for (let i = 0; i < (tries || 40); i++) {
    const st = await probe(port, 600);
    if (st.alive && st.mine) return true;
    await sleep(250);
  }
  return false;
}

/**
 * 确保有一个「属于本副本」的服务在跑，返回它实际监听的端口（0 表示失败）。
 *
 * 判断顺序：
 *   1. 端口上没东西         → 起自己的服务
 *   2. 端口上是我们的服务   → 直接复用
 *   3. 端口上是别人的副本   → 换一个空闲端口起自己的（不能复用：Token 不同，必然 403）
 */
async function ensureServer() {
  const st = await probe(PORT, 800);
  if (st.alive && st.mine) return PORT;

  if (st.alive && !st.mine) {
    const who = st.foreign
      ? '非本程序的进程'
      : '目录 ' + (st.root || '未知') + ' 的副本（v' + (st.version || '?') + '）';
    logRun('端口 ' + PORT + ' 已被另一个实例占用：' + who +
      '，其 Token 与本副本不同，复用会导致 403；改在空闲端口启动本副本的服务');

    let alt = 0;
    for (let p = PORT + 1; p < PORT + 80; p++) {
      if (await portFree(p)) { alt = p; break; }
    }
    if (!alt) { logErr('端口 ' + PORT + ' 被占用，且找不到空闲端口'); return 0; }

    PORT = alt;
    spawnServer(alt);
    if (await waitServer(alt)) {
      logRun('已在替代端口 ' + alt + ' 拉起本副本的服务（原端口 ' + CFG.port + ' 留给他用）');
      return alt;
    }
    logErr('替代端口 ' + alt + ' 上服务启动失败');
    return 0;
  }

  spawnServer(PORT);
  if (await waitServer(PORT)) return PORT;
  return 0;
}

function openUrl(url) {
  // 唤起默认浏览器。踩过的坑（本机实测）：
  //   1) rundll32 url.dll,FileProtocolHandler —— 静默失败：不报错，也不打开浏览器；
  //   2) cmd /c start "" <url> —— URL 里的 & 会被 cmd 当命令分隔符，必须整段加引号；
  //   3) explorer.exe <url> —— 走 ShellExecute，本机实测可用。
  //
  // 关键：不能"无脑重试"，否则一次双击会开好几个标签页。
  // 这里给 URL 加一个一次性 nonce，然后读服务端 access.log 确认页面真的被加载了，
  // 确认成功就停手；否则再换下一种方式。
  const nonce = crypto.randomBytes(4).toString('hex');
  const target = url + '&_probe=' + nonce;
  const marker = '_probe=' + nonce;

  // 顺序与等待时间来自本机对照实验（每种方式各测 2 轮）：
  //   rundll32  ✅✅  250ms / 1000ms（冷启动浏览器时实测 1.7s，所以窗口必须给足）
  //   cmd-start ✅✅  250ms（快，但要经过 cmd 解析，URL 里的 % 有被展开的风险，故放第二）
  //   explorer  ❌❌  两次都没打开（explorer.exe 传 URL 不可靠），仅作最后兜底
  const attempts = [
    {
      tag: 'rundll32',
      budget: 8000,
      run: () => execFile('rundll32', ['url.dll,FileProtocolHandler', target], { windowsHide: true }, noop)
    },
    {
      tag: 'cmd-start',
      budget: 8000,
      // windowsVerbatimArguments：原样拼命令行，URL 才能被引号完整包住
      run: () => spawn('cmd', ['/c', 'start "" "' + target + '"'], {
        windowsHide: true, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
      }).unref()
    },
    {
      tag: 'explorer',
      budget: 4000,
      run: () => execFile('explorer.exe', [target], { windowsHide: true }, noop)
    }
  ];

  const loaded = () => {
    try { return fs.readFileSync(ACCESS_LOG, 'utf8').indexOf(marker) !== -1; } catch (e) { return false; }
  };

  return (async () => {
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      try {
        a.run();
        logRun('openUrl: 已调用 ' + a.tag);
      } catch (e) {
        logRun('openUrl: ' + a.tag + ' 抛错 ' + (e && e.message));
        continue;
      }
      const rounds = Math.ceil(a.budget / 250);
      for (let k = 0; k < rounds; k++) {
        await sleep(250);
        if (loaded()) { logRun('openUrl: 浏览器已打开（' + a.tag + '，' + ((k + 1) * 250) + 'ms）'); return true; }
      }
      logRun('openUrl: ' + a.tag + ' 在 ' + a.budget + 'ms 内没有唤起浏览器，换下一种方式');
    }
    logRun('openUrl: 所有方式都没能唤起浏览器，URL 见上一行，可手动粘贴到地址栏');
    return false;
  })();
}

function notify(title, text) {
  const esc = (s) => String(s).replace(/[\\"']/g, '');
  try {
    execFile('mshta', ['javascript:alert("' + esc(title) + '\\n\\n' + esc(text) + '");close()'],
      { windowsHide: true }, () => {});
  } catch (e) { /* ignore */ }
}

(async () => {
  const argv = process.argv.slice(2);
  const noOpen = argv.includes('--no-open');
  const fileArg = argv.find((a) => a !== '--no-open');
  const target = fileArg ? path.resolve(fileArg) : null;

  const alive = await ensureServer();
  if (!alive) {
    logErr('本地服务启动失败，端口 ' + PORT);
    notify('md-tiny', 'Local service failed to start on port ' + PORT + '. See server-error.log.');
    process.exit(1);
  }

  const qs = ['token=' + encodeURIComponent(CFG.token)];
  if (target) {
    qs.push('open=' + encodeURIComponent(target));
    qs.push('dir=' + encodeURIComponent(path.dirname(target)));
  }
  // 用 ensureServer() 返回的端口，而不是配置里的端口：
  // 首选端口被别的副本占着时，我们的服务实际跑在替代端口上。
  const url = 'http://127.0.0.1:' + PORT + '/?' + qs.join('&');

  if (noOpen) { console.log(url); process.exit(0); }

  logRun('openUrl 目标: ' + url);
  const ok = await openUrl(url);
  // 不能提前 process.exit()：openUrl 内部有退避等待，提前退出会把重试掐掉
  logRun('launcher 结束，浏览器=' + (ok ? '已打开' : '未确认'));
})().catch((e) => {
  logErr(String(e && e.stack || e));
  process.exit(1);
});
