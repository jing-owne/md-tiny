#!/usr/bin/env node
// MDTN-A1 1.0 12823B20 oTUv0tOsKc98fWssMbFrL26-CY6ka-UpPT_0LfKm3yowOGftkPZWls4qu_LLJYxIy4PaGbKbrNvBDxCMbjn7AA
/**
 * md-tiny · 作者署名（MDTN-A1）
 * ----------------------------------------------------------------------------
 * 目的：**代码写出来的时候就带上作者署名**，用来主张原创、并在被抄走时留下可核验的痕迹。
 *       与 MDTN-F1（产物完整性自证）不同：MDTN-F1 谁都能重算，MDTN-A1 只有持有私钥的人
 *       签得出来 —— 所以别人可以**验证**，但无法**伪造**。
 *
 * 格式：
 *   MDTN-A1 <版本> <keyid> <签名>
 *     · <版本>  形如 1.0
 *     · <keyid> 8 位大写十六进制，是公钥的短摘要，用来对应 AUTHOR.pub
 *     · <签名>  Ed25519 签名的 64 字节，Base64URL 无填充（86 字符）
 *
 *   落地形态（按文件类型换注释符号，下面用 <注释> 代指）：
 *     .js   —— 行注释：双斜杠开头
 *     .css  —— 块注释：斜杠星号起、星号斜杠收
 *     .html —— HTML 注释
 *   三种形态里，署名内容都是同一行文本：MDTN-A1 1.0 3F8A21C4 <86 字符>
 *
 * 签名覆盖的内容：把「署名行」与「指纹行」都剔除后的文件正文。
 *   为什么两边都要剔：
 *     · 剔 MDTN-A1 行 —— 否则署名行自己也在被签内容里，写进去就对不上（自我引用）。
 *     · 剔 MDTN-F1 行 —— editor.js / richedit.js 里嵌着 MDTN-F1 指纹，而该指纹又依赖正文；
 *       两者若互相依赖就成死循环。剔掉之后依赖是单向的：先署名，再算指纹。
 *
 * 密钥：
 *   · 私钥 author.key —— **放仓库外**（默认 %USERPROFILE%\.mdtn-author\author.key），永不入库、永不随包分发。
 *   · 公钥 AUTHOR.pub —— 入库，任何人拿到仓库都能 `check` 验签。
 *   只有私钥在手才能签名；所以「能验出是你的签名」这件事，不依赖信任分发渠道。
 *
 * 用法：
 *   node tools/author.js init [--name 你的标识]   # 首次：生成密钥对（已存在则拒绝覆盖）
 *   node tools/author.js stamp                    # 给全部一方源码重新署名（写代码后跑）
 *   node tools/author.js check                    # 验签：逐文件核对署名是否成立
 *   node tools/author.js list                     # 列出哪些文件带了署名
 *   node tools/author.js where                    # 打印密钥位置与 keyid
 * ========================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PUB_PATH = path.join(ROOT, 'AUTHOR.pub');
// 公钥同时镜像进两个交付目录：这样别人拿到任意一个安装包，都能独立验证署名
const PUB_MIRRORS = [
  path.join(ROOT, 'extension', 'AUTHOR.pub'),
  path.join(ROOT, 'win', 'AUTHOR.pub')
];
// 私钥目录：可用 MDTN_AUTHOR_DIR 覆盖；默认落在用户主目录下，**刻意不在仓库里**
const KEY_DIR = process.env.MDTN_AUTHOR_DIR || path.join(os.homedir(), '.mdtn-author');
const KEY_PATH = path.join(KEY_DIR, 'author.key');

const PFX = 'MDTN-A1';

// 扫描范围：只覆盖本项目自有的源码，第三方 lib/ 与生成物一律不碰
const SCAN_ROOTS = ['extension', 'win', 'tools'];
const SKIP_DIRS = new Set(['lib', '_locales', 'icons', 'web', 'node_modules', '.git']);
const STYLES = { '.js': 'js', '.css': 'css', '.html': 'html' };

/** 署名行：三种注释外观都认，尾部的收尾符号可有可无 */
const MARK_RE = new RegExp(
  '^\\s*(?://\\s*|/\\*\\s*|<!--\\s*)?' + PFX +
  '\\s+\\d+(\\.\\d+){0,2}\\s+[0-9A-F]{8}\\s+[A-Za-z0-9_-]{86}\\s*(?:\\*/|-->)?\\s*$'
);

/** 任何「承载签名」的行都不参与被签内容（署名行 + 指纹行） */
function isCarrierLine(line) {
  return line.indexOf(PFX) !== -1 || line.indexOf('MDTN-F1') !== -1;
}

function stripCarriers(text) {
  return text.split('\n').filter((l) => !isCarrierLine(l)).join('\n');
}

function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')).version;
}

// ---------------------------------------------------------------- 密钥

function loadPrivate() {
  if (!fs.existsSync(KEY_PATH)) {
    fail('没有找到私钥：' + KEY_PATH + '\n  先跑一次：node tools/author.js init');
  }
  return crypto.createPrivateKey(fs.readFileSync(KEY_PATH, 'utf8'));
}

function loadPublic() {
  if (!fs.existsSync(PUB_PATH)) {
    fail('没有找到公钥：' + PUB_PATH + '\n  先跑一次：node tools/author.js init');
  }
  return crypto.createPublicKey(fs.readFileSync(PUB_PATH, 'utf8'));
}

/** keyid = 公钥 SPKI DER 的 SHA256 前 8 位十六进制（大写），用来与 AUTHOR.pub 对应 */
function keyIdOf(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 8).toUpperCase();
}

function b64u(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signingMessage(ver, keyid, content) {
  return Buffer.from(PFX + '|' + ver + '|' + keyid + '|' + content, 'utf8');
}

/** 把仓库根的公钥同步到两个交付目录（包内自带公钥，才能被独立验签） */
function syncPub() {
  if (!fs.existsSync(PUB_PATH)) return 0;
  const pem = fs.readFileSync(PUB_PATH);
  let n = 0;
  for (const p of PUB_MIRRORS) {
    if (!fs.existsSync(path.dirname(p))) continue;
    if (fs.existsSync(p) && fs.readFileSync(p).equals(pem)) continue;
    fs.writeFileSync(p, pem);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- 文件枚举与文本处理

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      walk(path.join(dir, ent.name), out);
    } else {
      const ext = path.extname(ent.name).toLowerCase();
      if (STYLES[ext]) out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

function targets() {
  const out = [];
  for (const r of SCAN_ROOTS) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs)) walk(abs, out);
  }
  return out.sort();
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

/** 拆分 BOM / 正文，并识别该文件的换行风格 */
function splitFile(text) {
  let bom = '';
  if (text.charCodeAt(0) === 0xfeff) { bom = '\ufeff'; text = text.slice(1); }
  return { bom, body: text, eol: text.indexOf('\r\n') !== -1 ? '\r\n' : '\n' };
}

/** 把署名行插到「合法且不破坏文件语义」的位置：shebang 之后、doctype 之后、其余置顶 */
function insertMark(body, eol, markLine) {
  const lines = body.split(/\r?\n/);
  let at = 0;
  if (/^#!/.test(lines[0] || '')) at = 1;
  else if (/^\s*<!doctype\b/i.test(lines[0] || '')) at = 1;
  lines.splice(at, 0, markLine);
  return lines.join(eol);
}

function wrap(style, line) {
  if (style === 'js') return '// ' + line;
  if (style === 'css') return '/* ' + line + ' */';
  return '<!-- ' + line + ' -->';
}

function readMark(text) {
  for (const l of text.split(/\r?\n/)) {
    if (MARK_RE.test(l)) {
      const m = l.match(new RegExp(PFX + '\\s+(\\d+(?:\\.\\d+){0,2})\\s+([0-9A-F]{8})\\s+([A-Za-z0-9_-]{86})'));
      if (m) return { ver: m[1], keyid: m[2], sig: m[3] };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 命令

function fail(msg) {
  process.stderr.write('[author] ' + msg + '\n');
  process.exit(1);
}

function cmdInit(args) {
  if (fs.existsSync(KEY_PATH)) {
    fail('私钥已存在，拒绝覆盖：' + KEY_PATH + '\n  要换密钥请先自行备份并删除它。');
  }
  const nameIdx = args.indexOf('--name');
  const name = nameIdx !== -1 ? String(args[nameIdx + 1] || '').trim() : '';

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(PUB_PATH, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  const mirrored = syncPub();

  const keyid = keyIdOf(publicKey);
  if (name) fs.writeFileSync(path.join(KEY_DIR, 'author.name'), name + '\n', 'utf8');

  console.log('已生成 Ed25519 密钥对');
  console.log('  私钥（仓库外，务必自己备份）：' + KEY_PATH);
  console.log('  公钥（已入库，供他人验签）：  ' + PUB_PATH);
  console.log('  公钥镜像到交付目录：          ' + mirrored + ' 处');
  console.log('  keyid：                      ' + keyid + (name ? '（' + name + '）' : ''));
  console.log('');
  console.log('下一步：node tools/author.js stamp');
}

function cmdStamp() {
  const priv = loadPrivate();
  const pub = loadPublic();
  const keyid = keyIdOf(pub);
  const ver = version();

  let touched = 0;
  let added = 0;
  for (const abs of targets()) {
    const raw = fs.readFileSync(abs, 'utf8');
    const { bom, body, eol } = splitFile(raw);

    // 先抹掉旧署名行（只抹整行匹配的，不误伤文档里提到格式的行）
    // 按 '\n' 切、按 '\n' 合：行尾的 '\r' 原样留在行上，CRLF 文件不会被悄悄改成 LF
    const cleaned = body.split('\n').filter((l) => !MARK_RE.test(l)).join('\n');
    const had = readMark(body) !== null;

    const sig = crypto.sign(null, signingMessage(ver, keyid, stripCarriers(cleaned)), priv);
    const markLine = wrap(STYLES[path.extname(abs).toLowerCase()], PFX + ' ' + ver + ' ' + keyid + ' ' + b64u(sig));
    const next = bom + insertMark(cleaned, eol, markLine);

    if (next !== raw) {
      fs.writeFileSync(abs, next, 'utf8');
      touched++;
      if (!had) added++;
    }
  }
  console.log('署名完成（keyid ' + keyid + '，版本 ' + ver + '）');
  console.log('  扫描源码：' + targets().length + ' 个');
  console.log('  本次写入：' + touched + ' 个（其中新署名 ' + added + ' 个）');
  console.log('  公钥镜像：' + syncPub() + ' 处（extension/ 与 win/ 内各一份，供包内独立验签）');
  console.log('');
  console.log('提示：署名改变正文会让 MDTN-F1 指纹失效，接着跑：node tools/fingerprint.js');
}

function cmdCheck() {
  const pub = loadPublic();
  const keyid = keyIdOf(pub);
  const ver = version();

  let ok = 0;
  const missing = [];
  const bad = [];

  for (const abs of targets()) {
    const raw = fs.readFileSync(abs, 'utf8');
    const { body } = splitFile(raw);
    const mark = readMark(body);
    if (!mark) { missing.push(rel(abs)); continue; }
    if (mark.keyid !== keyid) { bad.push(rel(abs) + '（keyid ' + mark.keyid + ' ≠ ' + keyid + '）'); continue; }
    if (mark.ver !== ver) { bad.push(rel(abs) + '（署名为 v' + mark.ver + '，当前 v' + ver + '）'); continue; }
    const cleaned = body.split('\n').filter((l) => !MARK_RE.test(l)).join('\n');
    const data = signingMessage(mark.ver, mark.keyid, stripCarriers(cleaned));
    const sigBuf = Buffer.from(mark.sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (crypto.verify(null, data, pub, sigBuf)) ok++;
    else bad.push(rel(abs) + '（内容与署名不符：被改过或署名过期）');
  }

  console.log('作者署名核验（keyid ' + keyid + '）');
  console.log('  署名有效：' + ok + ' 个');
  if (missing.length) console.log('  未署名：  ' + missing.length + ' 个\n    ' + missing.join('\n    '));
  if (bad.length) console.log('  署名不符：' + bad.length + ' 个\n    ' + bad.join('\n    '));

  if (!missing.length && !bad.length) {
    console.log('\n全部源码署名有效 ✓');
    return;
  }
  console.log('\n跑一次 node tools/author.js stamp 可补齐/刷新署名。');
  process.exitCode = 1;
}

function cmdList() {
  const pub = fs.existsSync(PUB_PATH) ? loadPublic() : null;
  const keyid = pub ? keyIdOf(pub) : '(未生成公钥)';
  const rows = [];
  for (const abs of targets()) {
    const { body } = splitFile(fs.readFileSync(abs, 'utf8'));
    const mark = readMark(body);
    rows.push({ file: rel(abs), mark });
  }
  console.log('keyid：' + keyid + '   共 ' + rows.length + ' 个一方源码');
  console.log('');
  for (const r of rows) {
    console.log('  ' + (r.mark ? '✅ ' + r.mark.ver + ' ' + r.mark.keyid : '⛔ 未署名') + '  ' + r.file);
  }
}

function cmdWhere() {
  console.log('私钥（仓库外，勿入库勿分发）：' + KEY_PATH);
  console.log('  存在：' + (fs.existsSync(KEY_PATH) ? '是' : '否（先跑 init）'));
  console.log('公钥（入库，供他人验签）：    ' + PUB_PATH);
  console.log('  存在：' + (fs.existsSync(PUB_PATH) ? '是' : '否（先跑 init）'));
  if (fs.existsSync(PUB_PATH)) console.log('keyid：                       ' + keyIdOf(loadPublic()));
  console.log('');
  console.log('看署名：任意源码文件首行，形如 MDTN-A1 1.0 <keyid> <签名>');
  console.log('验署名：node tools/author.js check');
}

const cmd = process.argv[2] || 'check';
const rest = process.argv.slice(3);
if (cmd === 'init') cmdInit(rest);
else if (cmd === 'stamp') cmdStamp();
else if (cmd === 'check') cmdCheck();
else if (cmd === 'list') cmdList();
else if (cmd === 'where') cmdWhere();
else fail('未知命令：' + cmd + '\n  可用：init / stamp / check / list / where');
