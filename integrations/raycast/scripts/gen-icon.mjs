// Generates assets/command-icon.png (512x512) with no dependencies — a simple
// "three connected nodes" graph motif on a dark rounded background. Replace with
// real artwork whenever; this just satisfies Raycast's required-icon check.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const S = 512;
const buf = Buffer.alloc(S * S * 4);

const BG = [13, 17, 23, 255]; // #0d1117
const NODE = [88, 166, 255, 255]; // #58a6ff
const EDGE = [48, 54, 61, 255]; // #30363d

function set(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

// Background (with rounded corners via a corner-radius mask).
const radius = 96;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = Math.min(x, S - 1 - x);
    const cy = Math.min(y, S - 1 - y);
    const inCorner = cx < radius && cy < radius;
    const dx = radius - cx;
    const dy = radius - cy;
    const outside = inCorner && dx * dx + dy * dy > radius * radius;
    set(x, y, outside ? [0, 0, 0, 0] : BG);
  }
}

function disc(cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) set(x, y, color);
    }
  }
}

function line(x0, y0, x1, y1, width, color) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    disc(x, y, width, color);
  }
}

const nodes = [
  [150, 360],
  [360, 360],
  [256, 150],
];
line(nodes[0][0], nodes[0][1], nodes[1][0], nodes[1][1], 9, EDGE);
line(nodes[0][0], nodes[0][1], nodes[2][0], nodes[2][1], 9, EDGE);
line(nodes[1][0], nodes[1][1], nodes[2][0], nodes[2][1], 9, EDGE);
for (const [x, y] of nodes) disc(x, y, 46, NODE);

// --- PNG encoding ---
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Add filter byte (0) at the start of each scanline.
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "command-icon.png"), png);
console.log(`Wrote ${join(outDir, "command-icon.png")} (${png.length} bytes)`);
