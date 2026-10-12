// MDTN-A1 1.0 12823B20 8OL-W0tivbsjdf9fB5g_rCrKiK_sGIdGg1BUqo67lcl2D0EJ7_e7dOXs9kvpjCddwKYG6OPbMvnW3gpb5r8SAA
/**
 * md-tiny · 卸载脚本
 * 删除 install.js 写入的注册表项（仅 HKCU），并可选择清理运行时文件。
 *
 * 安全说明：只删除本程序自己的注册表项与值，
 *   不会删除 OpenWithProgids 整个键（那会连带删掉其它程序的关联项）。
 *
 * 用法：
 *   node uninstall.js            只删注册表
 *   node uninstall.js --purge    同时删除 node-path.txt / config.json / server-error.log
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const PROGID = 'MDTiny.md';
const APP_EXE = 'MDTiny.exe';
const BACKUP_FILE = 'assoc-backup.json';
const EXTS = ['.md', '.markdown', '.mdown', '.txt'];
const PURGE = process.argv.slice(2).includes('--purge');

function info(m) { console.log(m); }

function reg(args) {
  try {
    execFileSync('reg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e.stderr || e.message).trim() };
  }
}

function delTree(key) {
  const r = reg(['delete', key, '/f']);
  if (r.ok) info('  已删除键  ' + key);
  else if (/找不到|unable to find/i.test(r.msg)) info('  不存在，跳过  ' + key);
  else info('  删除失败  ' + key + ' -> ' + r.msg);
}

function delValue(key, value) {
  const r = reg(['delete', key, '/v', value, '/f']);
  if (r.ok) info('  已删除值  ' + key + ' :: ' + value);
  else if (/找不到|unable to find/i.test(r.msg)) info('  不存在，跳过  ' + key + ' :: ' + value);
  else info('  删除失败  ' + key + ' :: ' + value + ' -> ' + r.msg);
}

/** 读某键的默认值；键不存在返回 null */
function queryDefault(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const lines = out.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return '';
    const m = lines[lines.length - 1].match(/REG_\w+\s+(.*)$/);
    return m ? m[1].trim() : '';
  } catch (e) { return null; }
}

info('md-tiny · 卸载');
info('\n== 删除自有的 ProgID（整键）');
delTree('HKCU\\Software\\Classes\\' + PROGID);

info('\n== 删除 Applications 注册项（整键，自有）');
delTree('HKCU\\Software\\Classes\\Applications\\' + APP_EXE);
delTree('HKCU\\Software\\Classes\\Applications\\' + PROGID);   // 旧版本写过的键名

info('\n== 从 OpenWithProgids 中移除本程序的值（保留其它程序）');
for (const ext of EXTS) {
  delValue('HKCU\\Software\\Classes\\' + ext + '\\OpenWithProgids', PROGID);
  delValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + ext + '\\OpenWithProgids', PROGID);
}

info('\n== 还原扩展名的默认程序');
let backup = {};
try {
  const txt = fs.readFileSync(path.join(ROOT, BACKUP_FILE), 'utf8');
  backup = JSON.parse(txt.replace(/^\uFEFF/, ''));   // 去掉可能的 BOM
} catch (e) { backup = {}; }
for (const ext of EXTS) {
  const extKey = 'HKCU\\Software\\Classes\\' + ext;
  const cur = queryDefault(extKey);
  if (cur !== PROGID) continue;
  const prev = backup[ext] || '';
  const r = reg(['add', extKey, '/ve', '/t', 'REG_SZ', '/d', prev, '/f']);
  if (r.ok) info('  ' + ext + ' -> ' + (prev || '（空，即未指定）'));
  else info('  还原失败 ' + ext + ' -> ' + r.msg);
}
if (fs.existsSync(path.join(ROOT, BACKUP_FILE))) {
  fs.unlinkSync(path.join(ROOT, BACKUP_FILE));
  info('  已删除 ' + BACKUP_FILE);
}

if (PURGE) {
  info('\n== 清理运行时文件');
  for (const f of ['node-path.txt', 'config.json', 'server-error.log']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) { fs.unlinkSync(p); info('  已删除 ' + p); }
  }
}

info('\n== 完成');
info('  提示：资源管理器若仍显示旧图标/旧关联，注销或重启一次即可刷新缓存。');
info('  扩展名的默认程序已按安装前的记录还原；若原来是「用户手动指定」（UserChoice），');
info('  那一步无法由脚本改，需要到「设置 -> 应用 -> 默认应用」里自己改回。');
info('  代码与图标未删除，如需彻底移除请手动删除目录：' + ROOT);
