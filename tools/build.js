#!/usr/bin/env node
// MDTN-A1 1.0 12823B20 UAyCzCK2Kp4Ezb6d3vbliYAuvHeI9GU9rKJQDaJBApypZ_AJtebfxRrQUCjuwPTrHrNRS7prMd5GcP-LuK8MCg
/**
 * md-tiny · 构建工具（零第三方依赖）
 * ----------------------------------------------------------------------------
 * 用法：
 *   node tools/build.js              同步 + 打签名 + 出 dist 两个 zip + 打印 SHA256
 *   node tools/build.js sync         只做内核同步（extension -> win/web）
 *   node tools/build.js verify       校验仓库内 BUILD.SIG 与当前文件是否一致
 *
 * 设计要点：
 *   · 内核单源：编辑器内核（editor.js / editor.css / ui.js / i18n.js / theme.js /
 *     sig.js / lib）只在 extension/ 下维护，本脚本把它逐字节镜像到 win/web/，
 *     两版因此不可能出现行为漂移。
 *   · 生成式页面：win/web/index.html 由 extension/editor.html 生成，仅在
 *     </body> 前多挂一个 server-bridge.js。
 *   · zip 自带签名：每个包根目录写入 BUILD.SIG（逐文件 SHA256 + 内容指纹），
 *     分发后可直接用 node tools/build.js verify 复核。
 *   · zip 写入使用内置 zlib，不引入任何打包依赖；SOURCE_DATE_EPOCH
 *     可让产物可复现。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const WIN_DIR = path.join(ROOT, 'win');
const WIN_WEB = path.join(WIN_DIR, 'web');
const DIST = path.join(ROOT, 'dist');

const sig = require(path.join(EXT_DIR, 'sig.js'));

// 内核单源清单（相对各自目录）
const KERNEL_FILES = [
  'editor.js', 'editor.css', 'richedit.js',
  'sig.js', 'settings.js', 'settings-ui.js', 'settings.css',
  'i18n.js', 'theme.js', 'ui.js'
];
const KERNEL_LIBS = ['lib'];

// win 包内不参与分发的运行期文件与开发期自测脚本
// （BUILD.SIG 由构建生成，必须随包分发，故不在此列）
const WIN_EXCLUDE = new Set([
  'config.json', 'node-path.txt', 'assoc-backup.json', 'node_modules',
  // 开发期自测：只在源码仓库本地跑，不进发布包
  'test-server.js', 'test-launcher.js', 'test-e2e.js'
]);

/**
 * win 包的排除判定：固定名单 + 一切 *.log + 一切点开头的项（.tmp-launch / .tmp-test 等）。
 * 签名与打包共用这一份判定，避免出现「签名里有、包里没有」或把测试残渣打进包里。
 */
function isWinRuntime(name) {
  return WIN_EXCLUDE.has(name) || /\.log$/i.test(name) || name.startsWith('.');
}

/** 扩展包的排除判定：点开头的项一律不进包 */
function isExtRuntime(name) {
  return name.startsWith('.');
}

function version() {
  const mf = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  return mf.version;
}

function log(msg) { process.stdout.write(msg + '\n'); }

// ---------------------------------------------------------------- 同步

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function sync() {
  fs.mkdirSync(WIN_WEB, { recursive: true });

  for (const f of KERNEL_FILES) {
    fs.copyFileSync(path.join(EXT_DIR, f), path.join(WIN_WEB, f));
  }
  for (const d of KERNEL_LIBS) {
    fs.rmSync(path.join(WIN_WEB, d), { recursive: true, force: true });
    copyDir(path.join(EXT_DIR, d), path.join(WIN_WEB, d));
  }

  // 生成本地服务版页面：内核页面 + 服务桥接
  const html = fs.readFileSync(path.join(EXT_DIR, 'editor.html'), 'utf8');
  const bridge = '<!-- 本地服务模式桥接：无 ?token= 时自动退出，不影响原有行为 -->\n' +
    '<script src="server-bridge.js"></script>\n';
  const out = html.replace(/\n<\/body>/, '\n' + bridge + '</body>');
  fs.writeFileSync(path.join(WIN_WEB, 'index.html'), out, 'utf8');

  log('  [sync] ' + KERNEL_FILES.length + ' 个内核文件 + lib/ 已镜像到 win/web/');
}

// ---------------------------------------------------------------- 文件枚举

function walk(dir, base, out, exclude) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude && !base) {
      const skip = typeof exclude === 'function' ? exclude(ent.name) : exclude.has(ent.name);
      if (skip) continue;
    }
    const full = path.join(dir, ent.name);
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(full, rel, out, exclude);
    else out.push(rel);
  }
  return out;
}

function listPkg(dir, exclude) {
  return walk(dir, '', [], exclude).sort();
}

// ---------------------------------------------------------------- 签名

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildStamp(pkgName, dir, files, ver, excludeNames) {
  const lines = [];
  const digests = [];
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(dir, rel));
    const h = sha256(buf);
    digests.push(h + '  ' + rel);
  }
  const contentFp = sig.fingerprint(digests.join('\n'), ver);

  lines.push('MDTN-SIG/1');
  lines.push('package: ' + pkgName);
  lines.push('version: ' + ver);
  lines.push('built:   ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
  lines.push('files:   ' + files.length);
  lines.push('content-fingerprint: ' + contentFp);
  lines.push('');
  lines.push('# sha256                                                            path');
  for (const d of digests) lines.push(d);
  lines.push('');
  return lines.join('\n');
}

function writeStamps(ver) {
  // BUILD.SIG 自身不参与逐文件摘要（否则每次重建都会因自引用而不一致）
  const skipSig = new Set(['BUILD.SIG']);
  const extFiles = listPkg(EXT_DIR, (name) => skipSig.has(name) || isExtRuntime(name));
  const winFiles = listPkg(WIN_DIR, (name) => skipSig.has(name) || isWinRuntime(name));

  // 先把 BUILD.SIG 自身排除在清单外，再写入，避免自引用
  const extStamp = buildStamp('md-tiny-extension', EXT_DIR, extFiles, ver, null);
  const winStamp = buildStamp('md-tiny-win', WIN_DIR, winFiles, ver, WIN_EXCLUDE);
  const extFp = (extStamp.match(/^content-fingerprint: (.*)$/m) || [])[1] || '?';
  const winFp = (winStamp.match(/^content-fingerprint: (.*)$/m) || [])[1] || '?';
  fs.writeFileSync(path.join(EXT_DIR, 'BUILD.SIG'), extStamp, 'utf8');
  fs.writeFileSync(path.join(WIN_DIR, 'BUILD.SIG'), winStamp, 'utf8');

  log('  [stamp] extension: ' + extFiles.length + ' 文件 · ' + extFp);
  log('  [stamp] win      : ' + winFiles.length + ' 文件 · ' + winFp);
}

// ---------------------------------------------------------------- 校验

function verify() {
  const ver = version();
  let bad = 0;

  const check = (dir, sigPath, label) => {
    if (!fs.existsSync(sigPath)) { log('  [verify] ' + label + ' 缺少 BUILD.SIG'); bad++; return; }
    const text = fs.readFileSync(sigPath, 'utf8');
    const ctx = text.match(/^content-fingerprint: (.*)$/m);
    const entries = text.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[0-9a-f]{64} {2}/.test(l))
      .map((l) => ({ hash: l.slice(0, 64), rel: l.slice(66) }));

    const digests = [];
    let mismatch = 0;
    for (const e of entries) {
      const p = path.join(dir, e.rel);
      if (!fs.existsSync(p)) { log('    缺失: ' + e.rel); mismatch++; continue; }
      const h = sha256(fs.readFileSync(p));
      if (h !== e.hash) { log('    内容已变: ' + e.rel); mismatch++; }
      digests.push(h + '  ' + e.rel);
    }
    const fp = sig.fingerprint(digests.join('\n'), ver);
    const ok = mismatch === 0 && ctx && ctx[1] === fp;
    log('  [verify] ' + label + ' -> ' + (ok ? '一致 ✓' : '不一致 ✗ (' + mismatch + ' 处差异)'));
    if (!ok) bad++;
  };

  log('校验 BUILD.SIG（版本 ' + ver + '）');
  check(EXT_DIR, path.join(EXT_DIR, 'BUILD.SIG'), 'extension');
  check(WIN_DIR, path.join(WIN_DIR, 'BUILD.SIG'), 'win');

  // 内核单源：win/web 必须是 extension 的逐字节镜像（页面除外，它是生成物）。
  // 少了这一步，"只改了一边"这种漂移不会被签名校验发现 —— 每个包的签名各自自洽。
  const genHtml = fs.readFileSync(path.join(EXT_DIR, 'editor.html'), 'utf8')
    .replace(/\n<\/body>/, '\n<!-- 本地服务模式桥接：无 ?token= 时自动退出，不影响原有行为 -->\n' +
      '<script src="server-bridge.js"></script>\n</body>');
  const mirror = KERNEL_FILES.map((f) => ({ rel: f, a: path.join(EXT_DIR, f), b: path.join(WIN_WEB, f) }));
  mirror.push({ rel: 'index.html（生成物）', a: null, b: path.join(WIN_WEB, 'index.html'), text: genHtml });
  let drift = 0;
  for (const m of mirror) {
    const bp = m.b ? fs.readFileSync(m.b) : null;
    let same;
    try {
      same = m.a ? fs.readFileSync(m.a).equals(bp) : bp.toString('utf8') === m.text;
    } catch (e) { same = false; }
    if (!same) { log('    内核漂移: ' + m.rel); drift++; }
  }
  log('  [verify] 内核镜像 -> ' + (drift === 0 ? 'extension 与 win/web 一致 ✓' : '有 ' + drift + ' 处漂移 ✗'));
  if (drift) bad++;

  return bad === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- ZIP

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  };
}

/**
 * 用内置 zlib 写一个最小可用的 zip。目录项不写入（Windows 资源管理器可正常解压）。
 * @param {string} outPath
 * @param {Array<{name:string, buf:Buffer}>} entries
 */
function writeZip(outPath, entries) {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const when = isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date();
  const { time, date } = dosTime(when);

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.buf;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // version made by
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.concat(chunks.concat([centralBuf, eocd])));
}

function packDir(dir, topName, excludeNames, outPath) {
  const files = listPkg(dir, excludeNames);
  const entries = files.map((rel) => ({
    name: topName + '/' + rel,
    buf: fs.readFileSync(path.join(dir, rel))
  }));
  writeZip(outPath, entries);
  return { files: files.length, bytes: fs.statSync(outPath).size };
}

function pack(ver) {
  fs.mkdirSync(DIST, { recursive: true });

  const extZip = path.join(DIST, 'md-tiny-extension-v' + ver + '.zip');
  const winZip = path.join(DIST, 'md-tiny-win-v' + ver + '.zip');

  const a = packDir(EXT_DIR, 'md-tiny-extension', isExtRuntime, extZip);
  const b = packDir(WIN_DIR, 'md-tiny-win', isWinRuntime, winZip);

  const rows = [
    { name: path.basename(extZip), r: a },
    { name: path.basename(winZip), r: b }
  ];
  log('');
  log('产物（dist/）');
  for (const row of rows) {
    const buf = fs.readFileSync(path.join(DIST, row.name));
    log('  ' + row.name.padEnd(36) + String(row.r.bytes).padStart(9) + ' B   ' +
      row.r.files + ' 文件   sha256 ' + sha256(buf));
  }
  return rows;
}

// ---------------------------------------------------------------- main

function main() {
  const cmd = process.argv[2] || 'all';

  if (cmd === 'verify') {
    return process.exitCode = verify();
  }

  const ver = version();
  log('md-tiny · 构建 v' + ver);
  log('');

  if (cmd === 'sync') {
    sync();
    return;
  }

  sync();
  writeStamps(ver);
  pack(ver);
  log('');
  log('完成。');
}

main();
