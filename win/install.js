// MDTN-A1 1.0 12823B20 iQNWp-HBCYgFFQSJ3V5z1IqKv2Is7h-tI-YtOJnArWjynA3HXIo3l49F_zJMOKrHc03QazzNys68JiJSAc14Aw
/**
 * md-tiny · 安装脚本
 *
 * 做的事（全部在 HKCU 当前用户下，不需要管理员权限）：
 *   1. 记录 node 绝对路径到 node-path.txt
 *   2. 生成 config.json（随机端口 + 随机 Token）
 *   3. 由 PNG 生成 icons/md-tiny.ico（文件类型图标）
 *   4. 注册文件关联：
 *        HKCU\Software\Classes\MDTiny.md\shell\open\command
 *        HKCU\Software\Classes\Applications\MDTiny.md\...   （让「打开方式」里显示正确名字）
 *        HKCU\Software\Classes\<ext>\OpenWithProgids  (MDTiny.md)
 *        HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\<ext>\OpenWithProgids
 *
 * 用法：
 *   node install.js              注册 .md / .markdown / .mdown
 *   node install.js --with-txt   额外注册 .txt
 *   node install.js --dry-run    只打印将执行的命令，不改注册表
 *   node uninstall.js            卸载（删除上述注册表项）
 *
 * 注意：关联属于「当前用户」，全局只有一份。在另一个目录再跑一次安装，就会把原来
 *       那份顶掉（本脚本会把新旧目录都打印出来）。同一台机器上请勿保留多份已安装副本。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, DEFAULT_PORT } = require('./config');

const ROOT = __dirname;
const PROGID = 'MDTiny.md';
const PROGID_DESC = 'Markdown 文档（md-tiny）';
// 显示在「打开方式」里的应用名。
// 注意：Windows 解析这个名字时，是拿 shell\open\command 里那个 exe 去
// HKCR\Applications\<exe> 下找 FriendlyAppName；我们的 exe 是 wscript.exe，
// 所以放在 ProgID 上的 FriendlyAppName 不生效，会显示成
// 「Microsoft ® Windows Based Script Host」——用户根本认不出。
const APP_FRIENDLY = 'md-tiny';
// 「打开方式」列表只枚举 key 名形如 *.exe 的 Applications 项，
// 所以这里必须用一个 .exe 结尾的名字（见 registerAssociation 注释）。
const APP_EXE = 'MDTiny.exe';
const BACKUP_FILE = 'assoc-backup.json';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const WITH_TXT = args.includes('--with-txt');
const ICON_ONLY = args.includes('--icon-only');

const EXTS = ['.md', '.markdown', '.mdown'].concat(WITH_TXT ? ['.txt'] : []);

function info(msg) { console.log(msg); }
function step(msg) { console.log('\n== ' + msg); }

// ------------------------------------------------------------- 1. node 路径

function writeNodePath() {
  step('记录 node 路径');

  // 优先用 PATH 里的 node（通常是稳定安装位置），避免把临时/托管运行时路径写死
  var candidates = [];
  try {
    var out = execFileSync('where', ['node'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    out.split(/\r?\n/).forEach(function (l) {
      var p = l.trim();
      if (p && !candidates.includes(p)) candidates.push(p);
    });
  } catch (e) { /* PATH 里没有 */ }
  candidates.push(process.execPath);

  var chosen = candidates[0];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    // 跳过临时目录 / 托管运行时路径，优先稳定安装
    if (/(\\temp\\|\\appdata\\local\\temp\\|\.workbuddy\\)/i.test(c)) continue;
    chosen = c;
    break;
  }

  if (!DRY) fs.writeFileSync(path.join(ROOT, 'node-path.txt'), chosen, 'utf8');
  info('  node: ' + chosen);
  if (/\.workbuddy\\/i.test(chosen)) {
    info('  提示：当前使用的是临时/托管 node。建议用系统安装的 node 重新运行本脚本。');
  }
}

// ------------------------------------------------------------- 2. 配置

function writeConfig() {
  step('生成/校验配置');

  // 预览不该留下任何痕迹：loadConfig() 在配置缺失/非法时会顺手把 config.json 写出来，
  // 所以 --dry-run 下自己只读一遍，别调它。
  if (DRY) {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) { raw = null; }
    const ok = raw && typeof raw === 'object' &&
      typeof raw.port === 'number' && raw.port >= 1024 && raw.port <= 65535 &&
      typeof raw.token === 'string' && raw.token.length >= 32;
    if (ok) {
      info('  端口: ' + raw.port + '（沿用现有 config.json）');
      info('  Token: ' + raw.token.slice(0, 8) + '...（' + raw.token.length + ' 位）');
    } else {
      info('  尚无可用 config.json —— 实际安装时会生成：端口 ' + DEFAULT_PORT + ' + 24 字节随机 Token');
    }
    return;
  }

  const cfg = loadConfig();
  info('  端口: ' + cfg.port);
  info('  Token: ' + cfg.token.slice(0, 8) + '...（' + cfg.token.length + ' 位）');
}

// ------------------------------------------------------------- 3. 生成 ICO

function pngSize(buf) {
  // PNG: 8 字节签名 + IHDR 长度/类型 + 宽(4) 高(4)
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function makeIco() {
  step('生成文件类型图标 md-tiny.ico');
  const sizes = [16, 32, 48, 128];
  const images = [];
  for (const s of sizes) {
    const p = path.join(ROOT, 'icons', 'icon' + s + '.png');
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    const dim = pngSize(buf);
    if (!dim) { info('  跳过（不是 PNG）: ' + p); continue; }
    images.push({ buf, w: dim.w, h: dim.h });
  }
  if (images.length === 0) { info('  没有可用图标，跳过'); return null; }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);          // 1 = ICO
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.w >= 256 ? 0 : img.w, 0);
    e.writeUInt8(img.h >= 256 ? 0 : img.h, 1);
    e.writeUInt8(0, 2);                // 调色板数
    e.writeUInt8(0, 3);                // 保留
    e.writeUInt16LE(1, 4);             // 色彩平面
    e.writeUInt16LE(32, 6);            // 位深
    e.writeUInt32LE(img.buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.buf.length;
    entries.push(e);
  }

  const out = Buffer.concat([header].concat(entries, images.map((i) => i.buf)));
  const outPath = path.join(ROOT, 'icons', 'md-tiny.ico');
  if (!DRY) fs.writeFileSync(outPath, out);
  info('  写入 ' + outPath + '（' + images.map((i) => i.w + 'x' + i.h).join(', ') + '，共 ' + out.length + ' 字节）');
  return outPath;
}

// ------------------------------------------------------------- 4. 注册表

function regShow(a) {
  info('  [dry-run] reg ' + a.map((x) => (/[\s"]/.test(x) ? '"' + x + '"' : x)).join(' '));
}

function regAdd(key, valueName, type, data) {
  const a = ['add', key];
  if (valueName === null) {
    a.push('/ve');
  } else {
    a.push('/v', valueName);
  }
  a.push('/t', type);
  // 不带 /d 时 reg 会写成 0 长度的空值；带 /d "" 反而会写成 2 个字节
  if (data !== undefined) a.push('/d', data);
  a.push('/f');
  if (DRY) { regShow(a); return; }
  try {
    execFileSync('reg', a, { stdio: 'pipe', windowsHide: true });
  } catch (e) {
    const detail = String((e && (e.stderr || e.message)) || e).trim().split('\n')[0];
    throw new Error(
      '写入注册表失败\n' +
      '    键  : ' + key + (valueName ? '  :: ' + valueName : '') + '\n' +
      '    原因: ' + detail + '\n' +
      '    常见情况：安全软件 / 组策略拦截了 reg.exe；或当前不是本机交互会话。\n' +
      '    处理：请在资源管理器中双击「安装.cmd」重试，或把 reg.exe 加入白名单。'
    );
  }
}

/** 写一个真正 0 长度的 REG_NONE 值（OpenWithProgids 的规范写法） */
function regAddNone(key, valueName) {
  regDelete(key, valueName);
  regAdd(key, valueName, 'REG_NONE');
}

/** 删除值或整键；不存在时静默忽略 */
function regDelete(key, valueName) {
  const a = ['delete', key];
  if (valueName !== null && valueName !== undefined) a.push('/v', valueName);
  a.push('/f');
  if (DRY) { regShow(a); return true; }
  try {
    execFileSync('reg', a, { stdio: 'pipe', windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 读某个键的默认值（查不到返回 null）。
 *
 * 只读操作，所以 --dry-run 下也照真读：否则预览会谎报「当前没有任何关联」，
 * 用户就看不到本次安装最要紧的那句提示 —— 它要顶掉的是哪一份。
 */
function regQueryDefault(key) {
  if (DRY) info('  [dry-run] reg query "' + key + '" /ve   （只读，照真读）');
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const lines = out.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return '';
    const m = lines[lines.length - 1].match(/REG_\w+\s+(.*)$/);
    return m ? m[1].trim() : '';
  } catch (e) {
    return null;   // 键不存在
  }
}

/** 读某个具名值（查不到返回 null）；同样只读，DRY 下照真读 */
function regQueryValue(key, name) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', name], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const m = out.match(new RegExp(name + '\\s+REG_\\w+\\s+(.*)', 'i'));
    return m ? m[1].trim() : '';
  } catch (e) {
    return null;
  }
}

function readBackup() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, BACKUP_FILE), 'utf8');
    return JSON.parse(txt.replace(/^\uFEFF/, ''));   // 去掉可能的 BOM
  } catch (e) { return {}; }
}

/** 端口上是否已有服务在监听（同步检查，仅用于安装后的提醒） */
function portInUse(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const re = new RegExp(':' + port + '\\s');
    return out.split(/\r?\n/).some((l) => re.test(l) && /LISTENING/i.test(l));
  } catch (e) {
    return false;   // 拿不到就当没有，不影响安装
  }
}

/**
 * 关联是「当前用户」全局的：同一时刻只能有一份 md-tiny 生效。
 * 在 B 目录再跑一次安装，A 目录的安装就被悄悄顶掉了 —— 而 A 目录的服务可能还在跑，
 * 于是 B 的页面带着 B 的 Token 去请求 A 的服务，服务端一律 403，
 * 用户看到的就是「服务起来了、文件打不开、页面是空的」。
 *
 * 启动器现在会改用空闲端口绕开这种局面，但至少要如实告诉用户：被顶掉的是哪一份。
 */
function warnDisplaced() {
  const key = 'HKCU\\Software\\Classes\\' + PROGID + '\\shell\\open\\command';
  const cmd = regQueryDefault(key);
  if (!cmd) return;

  // 命令行形如："...\wscript.exe" //B "...\open-md.vbs" "%1"
  const m = cmd.match(/"([^"]*open-md\.vbs)"/i) || cmd.match(/(\S*open-md\.vbs)/i);
  if (!m) return;

  const prevVbs = m[1];
  const prevDir = path.dirname(prevVbs);
  // 就是本目录 —— 重装，不算位移
  let same;
  try { same = path.resolve(prevDir).toLowerCase() === path.resolve(ROOT).toLowerCase(); }
  catch (e) { same = false; }
  if (same) return;

  if (fs.existsSync(prevVbs)) {
    info('  ⚠ 检测到另一份安装：' + prevDir);
    info('    文件关联是当前用户全局的，本目录安装后会把那份顶掉（同一时刻只有一份生效）。');
    info('    那份如果还在运行，它就占着端口；本副本的启动器会自动改用其它空闲端口，');
    info('    保证文件照样能打开。想彻底干净：先在任务管理器里结束那个 node.exe，');
    info('    或直接删掉上面那个旧目录。');
  } else {
    info('  ⚠ 检测到一条失效的旧关联（指向的目录已不存在）：' + prevDir);
  }
  info('    安装后关联将指向：' + ROOT);
  info('');
}

function registerAssociation() {
  step('注册文件关联（HKCU，无需管理员）');
  warnDisplaced();

  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const vbs = path.join(ROOT, 'open-md.vbs');
  const ico = path.join(ROOT, 'icons', 'md-tiny.ico');
  // 用 8.3 短路径可以规避命令行里的空格与引号嵌套问题
  const cmdLine = '"' + wscript + '" //B "' + vbs + '" "%1"';

  // --- 4.1 自有 ProgID ---
  regAdd('HKCU\\Software\\Classes\\' + PROGID, null, 'REG_SZ', PROGID_DESC);
  regAdd('HKCU\\Software\\Classes\\' + PROGID, 'FriendlyAppName', 'REG_SZ', APP_FRIENDLY);
  regAdd('HKCU\\Software\\Classes\\' + PROGID + '\\DefaultIcon', null, 'REG_SZ', ico + ',0');
  regAdd('HKCU\\Software\\Classes\\' + PROGID + '\\shell\\open\\command', null, 'REG_SZ', cmdLine);

  // --- 4.2 Applications 项（决定「打开方式」里显示的名字与图标）---
  // 两个坑：
  //   a) 名字取自 shell\open\command 里那个 exe 对应的 Applications 项，
  //      我们的 exe 是 wscript.exe -> 不注册就显示「Windows 脚本宿主」；
  //   b) Applications 下只有 *.exe 形式的 key 会被枚举，
  //      所以这里用 MDTiny.exe（命令仍走 wscript + open-md.vbs）。
  const appKey = 'HKCU\\Software\\Classes\\Applications\\' + APP_EXE;
  regAdd(appKey, null, 'REG_SZ', PROGID_DESC);
  regAdd(appKey, 'FriendlyAppName', 'REG_SZ', APP_FRIENDLY);
  regAdd(appKey + '\\DefaultIcon', null, 'REG_SZ', ico + ',0');
  regAdd(appKey + '\\shell\\open\\command', null, 'REG_SZ', cmdLine);
  for (const ext of EXTS) {
    regAdd(appKey + '\\SupportedTypes', ext, 'REG_SZ', '');
  }
  // 旧版本写过的 Applications\<ProgID>（key 名不是 .exe）永远不会被枚举，清掉
  regDelete('HKCU\\Software\\Classes\\Applications\\' + PROGID);

  // --- 4.3 扩展名登记 ---
  for (const ext of EXTS) {
    regAddNone('HKCU\\Software\\Classes\\' + ext + '\\OpenWithProgids', PROGID);
    regAddNone('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\OpenWithProgids', PROGID);
  }

  // --- 4.4 把扩展名的默认 ProgID 指过来 ---
  // 没有 UserChoice（用户手动指定过才有）时，双击就是按这里的默认 ProgID 走，
  // 所以这一步做完，双击 .md 立刻生效，不必去「设置」里选。
  const backup = readBackup();
  const touched = [];
  for (const ext of EXTS) {
    const extKey = 'HKCU\\Software\\Classes\\' + ext;
    const cur = regQueryDefault(extKey);
    if (cur !== PROGID) {
      if (cur) backup[ext] = cur;
      touched.push(ext);
    }
    regAdd(extKey, null, 'REG_SZ', PROGID);
  }
  if (touched.length && !DRY) {
    fs.writeFileSync(path.join(ROOT, BACKUP_FILE), JSON.stringify(backup, null, 2), 'utf8');
    info('  已记录原默认程序到 ' + BACKUP_FILE + '（卸载时会还原）');
  }

  // 已经手动选过默认程序的话，UserChoice 优先级更高，会盖住上面这一步
  const uc = regQueryValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.md\\UserChoice', 'ProgId');
  if (uc && uc !== PROGID) {
    info('');
    info('  ⚠ 系统里 .md 已被手动指定给「' + uc + '」');
    info('    这个优先级高于本脚本，需要在「设置 → 默认应用」里手动改成「' + APP_FRIENDLY + '」。');
  }

  info('');
  info('  关联的扩展名: ' + EXTS.join(', '));
  info('  应用显示名  : ' + APP_FRIENDLY);
  info('  打开命令    : ' + cmdLine);
}

// ------------------------------------------------------------- main

function main() {
  info('md-tiny · 本地启动器安装');
  info('安装目录: ' + ROOT);
  if (DRY) info('*** DRY RUN：不会真正修改注册表 ***');

  if (ICON_ONLY) {
    makeIco();
    step('完成（--icon-only：未改动注册表、未写配置）');
    return;
  }

  writeNodePath();
  writeConfig();
  makeIco();
  registerAssociation();

  step('完成');
  if (DRY) {
    info('  以上为预览。去掉 --dry-run 重新运行即可真正写入。');
  } else {
    info('  现在双击任意 .md 就应该用本编辑器打开了（Ctrl+S 直接写回原文件）。');

    // 同一台机器上多份副本共用一个端口，是「双击后文件打不开、页面空白」的典型成因：
    // 端口上跑的是 A 副本的服务（认 A 的 Token），而关联指向 B 副本 —— B 的页面带着
    // B 的 Token 去请求，服务端一律 403。启动器现在会自动改用空闲端口绕开，
    // 但更省事的做法是让端口上那个服务直接换成这一份。
    const cfgPort = loadConfig().port;
    if (portInUse(cfgPort)) {
      info('');
      info('  ⚠ 端口 ' + cfgPort + ' 上已有服务在运行。');
      info('    如果它是另一个 md-tiny 目录（旧副本）的服务，它不认识本目录的 Token。');
      info('    启动器会自动改用其它空闲端口保证文件能打开；若希望端口上跑的就是本目录的代码，');
      info('    请先在任务管理器里结束那个 node.exe，再双击文件（会自动拉起本目录的服务）。');
    }
    info('');
    info('  如果系统里 .md 的默认程序是你以前手动选过的（UserChoice），');
    info('  它会盖过本脚本，需要手工改一次：');
    info('    设置 -> 应用 -> 默认应用 -> 按文件类型选择默认应用 -> .md');
    info('    -> 选「' + APP_FRIENDLY + '」-> 设置默认值');
    info('');
    info('  找不到「' + APP_FRIENDLY + '」？看这一条：');
    info('    「打开方式」列表里的应用名，是 Windows 拿命令里那个 exe 去');
    info('    Applications 下查 FriendlyAppName 得来的。本程序用 wscript.exe 起');
    info('    隐藏窗口，所以名字可能显示成「Microsoft ® Windows Based Script Host」');
    info('    —— 那就是本编辑器，选它即可（图标/名字修不了，除非换成编译版启动器）。');
    info('');
    info('  卸载：node uninstall.js');
  }
}

try {
  main();
} catch (e) {
  console.error('\n[安装未完成] ' + (e && e.message ? e.message : String(e)));
  console.error('  已写入的部分注册项可以用 node uninstall.js 清除后重试。');
  process.exit(1);
}
