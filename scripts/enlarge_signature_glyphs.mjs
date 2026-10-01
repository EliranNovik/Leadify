#!/usr/bin/env node
/**
 * Enlarge the glyph inside each social signature icon without changing the badge.
 *
 * The icons in public/signature-icons are single PNGs holding both the coloured badge and the white
 * glyph, so the glyph's size relative to the badge is fixed in the artwork and no amount of CSS can
 * change it. Outlook rules out the obvious alternatives: it ignores `overflow` on images, so zooming
 * inside a clipped box is out, and it ignores `border-radius` on table cells, so drawing the badge
 * as a coloured cell with a separate transparent glyph on top is out too.
 *
 * What this does instead is resample each icon about its centre. Because the badge is a flat colour
 * field, magnifying it leaves it unchanged, while the glyph in the middle grows. The original alpha
 * channel is then reapplied so the outer silhouette — circle or rounded square, antialiased edge and
 * all — comes through exactly as drawn.
 *
 * No dependencies: PNG decoding and encoding are done here against node:zlib.
 *
 *   node scripts/enlarge_signature_glyphs.mjs            # default zoom, default icon set
 *   node scripts/enlarge_signature_glyphs.mjs 1.5         # stronger zoom
 *   node scripts/enlarge_signature_glyphs.mjs 1.35 a.png  # specific files
 *
 * Originals are copied to public/signature-icons/original/ the first time, so re-running with a
 * different zoom always starts from the untouched artwork rather than compounding.
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON_DIR = join(ROOT, 'public', 'signature-icons');
const BACKUP_DIR = join(ICON_DIR, 'original');
const DEFAULT_ZOOM = 1.35;
const DEFAULT_ICONS = ['facebook.png', 'linkedin.png', 'youtube.png', 'website.png'];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverse the per-scanline filters PNG applies before compression. */
function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;
      let recon;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + left; break;
        case 2: recon = value + up; break;
        case 3: recon = value + ((left + up) >> 1); break;
        case 4: recon = value + paeth(left, up, upLeft); break;
        default: throw new Error(`Unsupported PNG filter type ${filter} on row ${y}`);
      }
      out[rowStart + x] = recon & 0xff;
    }
    pos += stride;
  }
  return out;
}

/** Decode a non-interlaced 8-bit PNG to { width, height, rgba }. */
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file');

  let offset = 8;
  let header = null;
  let palette = null;
  let paletteAlpha = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      paletteAlpha = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!header) throw new Error('PNG is missing its IHDR chunk');
  const { width, height, bitDepth, colorType, interlace } = header;
  if (bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${bitDepth}-bit)`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported');
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);
  if (colorType === 3 && !palette) throw new Error('Palette PNG is missing its PLTE chunk');

  const pixels = unfilter(inflateSync(Buffer.concat(idat)), width, height, channels);
  const rgba = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i += 1) {
    const src = i * channels;
    const dst = i * 4;
    switch (colorType) {
      case 0:
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = pixels[src];
        rgba[dst + 3] = 255;
        break;
      case 2:
        rgba[dst] = pixels[src];
        rgba[dst + 1] = pixels[src + 1];
        rgba[dst + 2] = pixels[src + 2];
        rgba[dst + 3] = 255;
        break;
      case 3: {
        const index = pixels[src];
        rgba[dst] = palette[index * 3];
        rgba[dst + 1] = palette[index * 3 + 1];
        rgba[dst + 2] = palette[index * 3 + 2];
        rgba[dst + 3] = paletteAlpha && index < paletteAlpha.length ? paletteAlpha[index] : 255;
        break;
      }
      case 4:
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = pixels[src];
        rgba[dst + 3] = pixels[src + 1];
        break;
      default:
        rgba[dst] = pixels[src];
        rgba[dst + 1] = pixels[src + 1];
        rgba[dst + 2] = pixels[src + 2];
        rgba[dst + 3] = pixels[src + 3];
        break;
    }
  }

  return { width, height, rgba };
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  // Filter type 0 (None) on every scanline; zlib does the real work and these files are tiny.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bilinear sample with clamp-to-edge, so magnifying never runs off the artwork. */
function sample(rgba, width, height, fx, fy) {
  const cx = Math.min(width - 1, Math.max(0, fx));
  const cy = Math.min(height - 1, Math.max(0, fy));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const p00 = rgba[(y0 * width + x0) * 4 + c];
    const p10 = rgba[(y0 * width + x1) * 4 + c];
    const p01 = rgba[(y1 * width + x0) * 4 + c];
    const p11 = rgba[(y1 * width + x1) * 4 + c];
    const top = p00 + (p10 - p00) * tx;
    const bottom = p01 + (p11 - p01) * tx;
    out[c] = top + (bottom - top) * ty;
  }
  return out;
}

/** Most common fully opaque colour — the badge fill, used to patch any gap the zoom opens up. */
function dominantOpaqueColour(rgba) {
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 250) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return [(best >> 16) & 0xff, (best >> 8) & 0xff, best & 0xff];
}

function enlargeGlyph(image, zoom) {
  const { width, height, rgba } = image;
  const out = Buffer.alloc(rgba.length);
  const badge = dominantOpaqueColour(rgba);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      const [r, g, b, a] = sample(rgba, width, height, cx + (x - cx) / zoom, cy + (y - cy) / zoom);
      const opaqueEnough = a >= 8;
      out[dst] = Math.round(opaqueEnough ? r : badge[0]);
      out[dst + 1] = Math.round(opaqueEnough ? g : badge[1]);
      out[dst + 2] = Math.round(opaqueEnough ? b : badge[2]);
      // Keep the original silhouette: only the inside is magnified, never the outline.
      out[dst + 3] = rgba[dst + 3];
    }
  }

  return { width, height, rgba: out };
}

function main() {
  const args = process.argv.slice(2);
  const zoom = args.length && Number.isFinite(Number(args[0])) ? Number(args[0]) : DEFAULT_ZOOM;
  const names = (args.length && Number.isFinite(Number(args[0])) ? args.slice(1) : args)
    .map((a) => basename(a));
  const targets = names.length ? names : DEFAULT_ICONS;

  if (!(zoom > 1)) {
    console.error(`Zoom must be greater than 1 (got ${zoom}).`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`Enlarging glyphs by ${zoom}x\n`);

  for (const name of targets) {
    const target = join(ICON_DIR, name);
    if (!existsSync(target)) {
      console.warn(`  skip ${name} — not found`);
      continue;
    }
    const backup = join(BACKUP_DIR, name);
    // Always read the pristine original so repeated runs do not compound the magnification.
    if (!existsSync(backup)) copyFileSync(target, backup);

    try {
      const image = decodePng(readFileSync(backup));
      const badge = dominantOpaqueColour(image.rgba);
      const grown = enlargeGlyph(image, zoom);
      writeFileSync(target, encodePng(grown.width, grown.height, grown.rgba));
      const hex = badge.map((v) => v.toString(16).padStart(2, '0')).join('');
      console.log(`  ${name}: ${image.width}x${image.height}, badge #${hex} — done`);
    } catch (error) {
      console.error(`  ${name}: FAILED — ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\nOriginals kept in ${BACKUP_DIR}`);
  console.log('Bump the ?v= query in src/lib/generateEmailSignatureHtml.ts so clients refetch.');
}

main();
