import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const width = 800;
const height = 440;
const stride = width * 4 + 1;
const pixels = Buffer.alloc(stride * height);

for (let y = 0; y < height; y += 1) {
  const row = y * stride;
  pixels[row] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = row + 1 + x * 4;
    const border = x < 22 || x >= width - 22 || y < 22 || y >= height - 22;
    const dx = x - width / 2;
    const dy = y - height / 2;
    const ring = Math.abs(Math.hypot(dx, dy) - 105) < 12;
    const cross = (Math.abs(dx) < 9 && Math.abs(dy) < 52) || (Math.abs(dy) < 9 && Math.abs(dx) < 52);

    if (border || ring) {
      pixels.set([border ? 115 : 255, border ? 251 : 255, border ? 211 : 255, 235], offset);
    } else if (cross) {
      pixels.set([115, 251, 211, 255], offset);
    } else if (Math.hypot(dx, dy) < 93) {
      pixels.set([8, 18, 37, 145], offset);
    }
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header.set([8, 6, 0, 0, 0], 8);

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(pixels, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const spike of ["mindar-png"]) {
  const target = resolve(root, "spikes", spike, "public", "effect.png");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png);
}
