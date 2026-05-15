#!/usr/bin/env node
// Generates icons/icon{16,48,128}.png — run once: node generate-icons.js
const { deflateSync } = require('zlib');
const fs = require('fs');
const path = require('path');

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : (c >>> 1);
    t[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const cd = Buffer.concat([tb, data]);
  return Buffer.concat([u32be(data.length), tb, data, u32be(crc32(cd))]);
}

function makePNG(size, accent, base) {
  const ihdr = chunk('IHDR', Buffer.concat([
    u32be(size), u32be(size),
    Buffer.from([8, 2, 0, 0, 0])
  ]));

  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride, 0);
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.44;
  const innerR = size * 0.18;

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) - cx, dy = (y + 0.5) - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = y * stride + 1 + x * 3;
      if (d > outerR) {
        raw[i] = base[0]; raw[i+1] = base[1]; raw[i+2] = base[2];
      } else {
        const t = d / outerR;
        raw[i]   = Math.round(accent[0] + (255 - accent[0]) * t * 0.3);
        raw[i+1] = Math.round(accent[1] + (255 - accent[1]) * t * 0.3);
        raw[i+2] = Math.round(accent[2] + (255 - accent[2]) * t * 0.3);
        if (d < innerR) {
          // Clock hands — white
          raw[i] = 255; raw[i+1] = 255; raw[i+2] = 255;
        }
      }
    }
  }

  const idat = chunk('IDAT', deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ihdr, idat, iend]);
}

const hexToRgb = h => [
  parseInt(h.slice(1,3),16),
  parseInt(h.slice(3,5),16),
  parseInt(h.slice(5,7),16),
];

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

const ACCENT = hexToRgb('#A6B5A5');
const BASE   = hexToRgb('#F4EBDA');

for (const size of [16, 48, 128]) {
  const png = makePNG(size, ACCENT, BASE);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`✓ icons/icon${size}.png`);
}

console.log('Icons generated!');
