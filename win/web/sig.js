// MDTN-A1 1.0 12823B20 Q3FZbmdyWVl8zNdnGj2LZBzSFEMGEF5aCPmUGUiKh-YU18YX9m9YfKwvg3EMMUSx9Z5J8iFj_dmQ0EdAQ1gvDg
/* ============================================================================
 * MDTN-SIG · 自有签名与封装格式（v1）
 * ----------------------------------------------------------------------------
 * 本文件定义了 md-tiny 项目自有的两种文本格式。它们不依赖任何外部密码学
 * 标准，也不兼容通用算法，只服务于本项目内部的「产物自证」与「轻量封装」。
 *
 * ┌─ 指纹格式  MDTN-F1 ─────────────────────────────────────────────────────┐
 * │  MDTN-F1 <version> <b0 b1 b2 b3 b4 b5 b6 b7> <tail>                     │
 * │                                                                          │
 * │  · <version>  形如 1.1.0 的版本串                                        │
 * │  · <b0..b7>   8 个字节，每个写作两位大写十六进制，用单个空格分隔          │
 * │  · <tail>     3 位 Base36 校验尾                                         │
 * │                                                                          │
 * │  实例：MDTN-F1 1.1.0 4D 44 E0 1F 7C 3A 91 B5 Q7K                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 * ┌─ 封装格式  MDTN-E1 ─────────────────────────────────────────────────────┐
 * │  MDTN-E1 <rounds> <c0 c1 c2 ... >                                        │
 * │                                                                          │
 * │  · <rounds>   加密轮数（1–9），同时决定流偏移                            │
 * │  · <c0 c1 ..> 密文字节，两位大写十六进制、单空格分隔，每 16 字节换行      │
 * │                                                                          │
 * │  实例：MDTN-E1 3 A1 0F 5C 22 ...                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * 注意：指纹只做完整性自证，抗碰撞强度等同于 64+16 位校验，不可用于安全场景；
 *       封装是流式混淆而非密码学加密，请勿用来保护机密数据。
 * ========================================================================== */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MDTinySig = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SPEC = 'MDTN-SIG/1';
  var PFX_FP = 'MDTN-F1';
  var PFX_EC = 'MDTN-E1';
  var TAIL_ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  /* 固定盐：8 字节，取自本格式的首次定型值，改动会让所有历史指纹失效 */
  var SALT = [0x4d, 0x44, 0x45, 0xd0, 0x1f, 0x7c, 0x3a, 0x91];

  // ---------------------------------------------------------------- 基础工具

  /** 字符串 -> UTF-8 字节数组（不依赖 TextEncoder，保证 Node 与浏览器一致） */
  function bytesOf(str) {
    var s = String(str == null ? '' : str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
          continue;
        }
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  var HEX = '0123456789ABCDEF';

  function hex2(b) {
    var v = b & 0xff;
    return HEX.charAt((v >> 4) & 0xf) + HEX.charAt(v & 0xf);
  }

  /** 定长 Base36：不足补零，超出保留低位 —— 保证校验尾长度恒定（见 fingerprint） */
  function base36(n, width) {
    var v = n >>> 0;
    var s = '';
    do {
      s = TAIL_ALPHA.charAt(v % 36) + s;
      v = Math.floor(v / 36);
    } while (v > 0);
    while (s.length < width) s = '0' + s;
    return s.length > width ? s.slice(-width) : s;
  }

  /** FNV-1a 变体：以 32 位滚动的 4 条并行通道混入字节流 */
  function mix4(bytes, seed) {
    var a = (seed ^ 0x811c9dc5) >>> 0;
    var b = (seed + 0x01000193) >>> 0;
    var c = (seed ^ 0x9e3779b9) >>> 0;
    var d = (seed + 0x85ebca6b) >>> 0;
    for (var i = 0; i < bytes.length; i++) {
      var v = bytes[i] & 0xff;
      a = ((a ^ v) * 0x01000193) >>> 0;
      b = ((b + v) ^ (b << 5)) >>> 0;
      c = ((c ^ (v << (i & 7))) * 0x85ebca6b) >>> 0;
      d = (d + ((v * 31 + i) >>> 0)) >>> 0;
      d = ((d << 7) | (d >>> 25)) >>> 0;
    }
    return [a, b, c, d];
  }

  // ---------------------------------------------------------------- 指纹

  /**
   * 生成指纹。
   * @param {string} input 被签内容（文本或字节数组）
   * @param {string} [version] 版本串，缺省用 '0.0.0'
   * @returns {string} 形如 `MDTN-F1 1.1.0 4D 44 E0 1F 7C 3A 91 B5 Q7K`
   */
  function fingerprint(input, version) {
    var bytes = typeof input === 'string' ? bytesOf(input) : (input || []).slice();
    var ver = String(version || '0.0.0');
    var head = mix4(bytes, 0x2f6e2b1);
    var tailMix = mix4(bytesOf(ver).concat(bytes.slice(0, 4096)), SALT[0]);

    var out = [];
    for (var i = 0; i < 4; i++) {
      out.push((head[i] >>> 24) & 0xff, (head[i] >>> 16) & 0xff);
    }
    // 与版本混合，保证同一内容在不同版本下指纹不同
    for (var j = 0; j < 4; j++) {
      out[j] = (out[j] ^ SALT[j]) & 0xff;
    }

    var hex = [];
    for (var k = 0; k < 8; k++) hex.push(hex2(out[k]));
    // 校验尾固定 3 位 Base36：36^3 = 46656，先取模再编码，避免出现 4 位尾
    var sum = (tailMix[0] ^ tailMix[1] ^ tailMix[2] ^ tailMix[3]) % 46656;
    return PFX_FP + ' ' + ver + ' ' + hex.join(' ') + ' ' + base36(sum, 3);
  }

  /**
   * 校验指纹串结构是否合法（不重算内容）。
   * @param {string} text
   * @returns {boolean}
   */
  function verify(text) {
    return new RegExp(
      '^' + PFX_FP + ' \\d+(\\.\\d+){0,2}( [0-9A-F]{2}){8} [0-9A-Z]{3}$'
    ).test(String(text || '').trim());
  }

  // ---------------------------------------------------------------- 封装

  /** 由密钥展开出一条与环境无关的字节流（本格式自有） */
  function keystream(key, rounds, length) {
    var kb = bytesOf(key);
    var st = mix4(kb, SALT[3]);
    var out = new Array(length);
    var r = Math.max(1, Math.min(9, rounds | 0));
    for (var pass = 0; pass < r; pass++) {
      for (var i = 0; i < length; i++) {
        st = mix4([(kb[i % kb.length] + ((i * 7 + pass * 13) & 0xff)) & 0xff], st[0] ^ (i & 0xff));
        out[i] = (st[1] >>> 11) & 0xff;
      }
    }
    return out;
  }

  /**
   * 封装：把明文按自有格式输出为「空格分隔的十六进制字节串」。
   * @param {string} text
   * @param {string} key
   * @param {number} [rounds=3]
   * @returns {string}
   */
  function seal(text, key, rounds) {
    var r = Math.max(1, Math.min(9, rounds == null ? 3 : (rounds | 0)));
    var src = bytesOf(text);
    var ks = keystream(String(key || ''), r, src.length);
    var hex = new Array(src.length);
    for (var i = 0; i < src.length; i++) {
      hex[i] = hex2((src[i] ^ ks[i] ^ ((i * r) & 0xff)) & 0xff);
    }
    var body = [];
    for (var j = 0; j < hex.length; j += 16) {
      body.push(hex.slice(j, j + 16).join(' '));
    }
    return PFX_EC + ' ' + r + ' ' + body.join('\n');
  }

  /**
   * 解封装：seal 的逆运算。
   * @param {string} code
   * @param {string} key
   * @returns {string} 明文；格式不符时返回空串
   */
  function unseal(code, key) {
    var s = String(code || '').replace(/\s+/g, ' ').trim();
    var m = s.match(new RegExp('^' + PFX_EC + ' ([1-9]) ((?:[0-9A-F]{2} ?)+)$'));
    if (!m) return '';
    var r = parseInt(m[1], 10);
    var hex = m[2].trim().split(/\s+/);
    var ks = keystream(String(key || ''), r, hex.length);
    var chars = [];
    for (var i = 0; i < hex.length; i++) {
      chars.push((parseInt(hex[i], 16) ^ ks[i] ^ ((i * r) & 0xff)) & 0xff);
    }
    return utf8Decode(chars);
  }

  function utf8Decode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if (c < 0x80) {
        out += String.fromCharCode(c);
      } else if (c >= 0xc0 && c < 0xe0) {
        out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[++i] & 0x3f));
      } else if (c >= 0xe0 && c < 0xf0) {
        out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f));
      } else {
        var cp = ((c & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }

  return {
    SPEC: SPEC,
    PFX_FP: PFX_FP,
    PFX_EC: PFX_EC,
    SALT: SALT.slice(),
    bytesOf: bytesOf,
    fingerprint: fingerprint,
    verify: verify,
    seal: seal,
    unseal: unseal
  };
});
