// MDTN-A1 1.0 12823B20 DJ-4ecpYIxGsD-QfDAI8hwdXTfzeYw_jEI_4SEIqDKwKPIvfaSiYI1iV6sjyKeKLqP_llV7n6VfJZEXxiloLAg
/**
 * 共享配置读取/生成模块：端口 + 访问 Token。
 * 由 server.js 与 launcher.js 共用，保证两侧看到的配置一致。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DEFAULT_PORT = 8765;

function loadConfig() {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { cfg = null; }
  if (!cfg || typeof cfg !== 'object') cfg = {};

  let changed = false;
  if (typeof cfg.port !== 'number' || cfg.port < 1024 || cfg.port > 65535) {
    cfg.port = DEFAULT_PORT;
    changed = true;
  }
  if (typeof cfg.token !== 'string' || cfg.token.length < 32) {
    cfg.token = crypto.randomBytes(24).toString('hex');
    changed = true;
  }

  if (changed) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) { /* 只读时忽略 */ }
  }
  return cfg;
}

module.exports = { loadConfig, CONFIG_PATH, DEFAULT_PORT };
