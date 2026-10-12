#!/usr/bin/env node
// MDTN-A1 1.0 12823B20 Y7gOrEgH0EAFWHSZonVu1dLQnE9sdAG7OtD-KeNsUNymw_cBjebFhbQzgUF7aZ6XBV_yGae8udCkVhsxpBCXAg
/**
 * md-tiny · 指纹查看与重算
 * ----------------------------------------------------------------------------
 * 用法：node tools/fingerprint.js
 *
 * 打印四类指纹：
 *   1. 内核签名        editor.js 自身（剔除「含 MDTN-F1 的行」后计算）
 *   2. 富文本层签名    richedit.js 同上
 *   3. 设置导出指纹    默认设置内容的指纹（与设置面板「导出」的头部一致）
 *   4. 交付包签名      extension/BUILD.SIG、win/BUILD.SIG 里的 content-fingerprint
 *
 * 为什么头部签名要先把「含 MDTN-F1 的那一行」剔掉再算：
 *   签名要写回文件本身，若承载行参与计算就会自我引用 —— 写进去内容就变、内容变签名又变，
 *   永远对不上。剔掉承载行之后它就是文件内容的固定点，可以反复重算复核。
 *
 * 版本升级后：改完 VERSION 跑一次本脚本，把输出的三行示例值回填到
 *   extension/editor.js、extension/richedit.js、docs/技术说明.md；
 *   交付包签名由 node tools/build.js 重新生成，不必手改。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const WIN = path.join(ROOT, 'win');

const sig = require(path.join(EXT, 'sig.js'));

function version() {
  return JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version;
}

/** 剔除所有含 MDTN-F1 的行：承载行不参与自指纹计算，避免自我引用 */
function stripSigLines(text) {
  return text.split('\n').filter((l) => l.indexOf('MDTN-F1') === -1).join('\n');
}

function fileSig(rel) {
  return sig.fingerprint(stripSigLines(fs.readFileSync(path.join(EXT, rel), 'utf8')), version());
}

function settingsSig() {
  try {
    const S = require(path.join(EXT, 'settings.js'));
    return S.fingerprint();
  } catch (e) {
    return '（settings.js 未能在 Node 下加载：' + (e && e.message) + '）';
  }
}

function pkgSig(dir) {
  const p = path.join(dir, 'BUILD.SIG');
  if (!fs.existsSync(p)) return '（尚未构建：缺少 BUILD.SIG）';
  const m = fs.readFileSync(p, 'utf8').match(/^content-fingerprint:\s*(.+)$/m);
  return m ? m[1].trim() : '（BUILD.SIG 里没有 content-fingerprint）';
}

const ver = version();
console.log('版本（取自 extension/manifest.json）：' + ver);
console.log('');
console.log('内核签名        ' + fileSig('editor.js'));
console.log('富文本层签名    ' + fileSig('richedit.js'));
console.log('设置导出指纹    ' + settingsSig());
console.log('');
console.log('扩展包签名      ' + pkgSig(EXT));
console.log('Windows 包签名  ' + pkgSig(WIN));
console.log('');
console.log('复核包签名与内核镜像：node tools/build.js verify');
