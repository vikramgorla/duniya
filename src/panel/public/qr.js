// Minimal QR code encoder for the panel (027): byte mode, versions 1–10, error correction L/M/Q/H, automatic mask.
// Runs in the browser (no external service, no dependency). Follows ISO/IEC 18004; the structure follows Project
// Nayuki's reference implementation (MIT). Usage: DuniyaQR.encode('text', 'M') -> { size, dark(x, y) }.
(function (root) {
  'use strict';
  const LEVELS = { L: [1, 0], M: [0, 1], Q: [3, 2], H: [2, 3] }; // [format bits, table index]
  // Index 0 unused; versions 1..10.
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
  ];
  const BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
  ];
  const MAX_VERSION = 10;

  const rawModules = (ver) => {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  };
  const dataCodewords = (ver, li) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[li][ver] * BLOCKS[li][ver];

  // GF(256) with the QR polynomial 0x11D
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; };
  function divisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1; let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) { r[j] = mul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; }
      root = mul(root, 0x02);
    }
    return r;
  }
  function remainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
    return r;
  }
  const utf8 = (s) => (typeof TextEncoder !== 'undefined' ? Array.from(new TextEncoder().encode(s)) : Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0)));

  function encode(text, level = 'M', { mask: forcedMask = -1, minVersion = 1 } = {}) {
    const [formatBits, li] = LEVELS[level] || LEVELS.M;
    const bytes = utf8(String(text));
    let ver = Math.max(1, minVersion);
    for (; ver <= MAX_VERSION; ver++) {
      const ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver, li) * 8) break;
    }
    if (ver > MAX_VERSION) throw new Error('Text too long for a QR code here');
    // bit stream: mode 0100 (byte), count, data, terminator, pad
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4); push(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) push(b, 8);
    const cap = dataCodewords(ver, li) * 8;
    push(0, Math.min(4, cap - bits.length)); push(0, (8 - (bits.length % 8)) % 8);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) push(p, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    // error correction, interleaved
    const nBlocks = BLOCKS[li][ver]; const eccLen = ECC_PER_BLOCK[li][ver];
    const raw = Math.floor(rawModules(ver) / 8); const nShort = nBlocks - (raw % nBlocks); const shortLen = Math.floor(raw / nBlocks);
    const div = divisor(eccLen); const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length;
      const ecc = remainder(dat, div); if (i < nShort) dat.push(0); blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) codewords.push(b[i]); });

    // modules
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
    const align = [];
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2; const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      align.push(6); for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
    }
    align.forEach((ax, i) => align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const bit = (v, i) => ((v >>> i) & 1) !== 0;
    const drawFormat = (mask) => {
      const d = (formatBits << 3) | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412;
      for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
      set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
      set(8, size - 8, true);
    };
    drawFormat(0); // reserve
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const b = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3); const c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); }
    }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j; const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
        if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
    const MASKS = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
    const penalty = () => {
      let p = 0; let dark = 0;
      const lines = [];
      for (let y = 0; y < size; y++) { lines.push(m[y]); lines.push(m.map((row) => row[y])); }
      for (const line of lines) {
        let run = 1;
        for (let x = 1; x <= size; x++) {
          if (x < size && line[x] === line[x - 1]) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; }
        }
        const s = line.map((d) => (d ? 1 : 0)).join('');
        for (const pat of ['10111010000', '00001011101']) for (let k = s.indexOf(pat); k !== -1; k = s.indexOf(pat, k + 1)) p += 40;
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
      for (const row of m) for (const d of row) if (d) dark++;
      return p + 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
    };
    let mask = forcedMask;
    if (mask < 0) {
      let best = Infinity;
      for (let k = 0; k < 8; k++) { applyMask(k); drawFormat(k); const p = penalty(); if (p < best) { best = p; mask = k; } applyMask(k); }
    }
    applyMask(mask); drawFormat(mask);
    return { version: ver, mask, size, dark: (x, y) => m[y][x], modules: m };
  }

  /** SVG path data ("M x y h1 v1 h-1 z" per dark module), with a quiet-zone border. */
  function svgPath(qr, border = 4) {
    let d = '';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.dark(x, y)) d += `M${x + border} ${y + border}h1v1h-1z`;
    return { d, viewBox: `0 0 ${qr.size + border * 2} ${qr.size + border * 2}` };
  }

  root.DuniyaQR = { encode, svgPath };
})(typeof window !== 'undefined' ? window : globalThis);
