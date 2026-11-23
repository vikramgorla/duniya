// Pictures for the demo panel's messages (096): a photo and a sticker, drawn here as PNG so the demo needs no files,
// no network and no image library. Each is a function of the pixel's position.
import { crc32, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGBA = 6; // PNG colour type: red, green, blue, alpha (8 bits each)

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A PNG of w × h pixels; `pixel(x, y)` gives [r, g, b, a]. */
function png(w, h, pixel) {
  const row = w * 4 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * row + 1 + x * 4);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = RGBA;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
const near = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** The lake from the station: sky, the Alps, the water, the shore and a small blue car. 480 × 320. */
export const lakePhoto = () => png(480, 320, (x, y) => {
  const peak = 150 - 46 * Math.abs(Math.sin(x / 70)) - 18 * Math.abs(Math.sin(x / 23));
  const inCar = x > 300 && x < 400 && ((y > 252 && y < 280) || (y > 236 && y <= 252 && x > 320 && x < 380));
  if (near(x, y, 322, 282, 11) || near(x, y, 378, 282, 11)) return [34, 34, 38, 255];
  if (inCar) return y < 252 && x > 328 && x < 372 && y > 240 ? [190, 220, 240, 255] : [40, 96, 200, 255];
  if (y > 262) return mix([118, 150, 92, 255], [86, 112, 70, 255], (y - 262) / 58);
  if (y > 176) return mix([84, 140, 190, 255], [52, 104, 160, 255], (y - 176) / 86);
  if (y > peak) return mix([238, 242, 248, 255], [120, 132, 150, 255], (y - peak) / 30);
  return mix([126, 178, 232, 255], [214, 232, 248, 255], y / 176);
});

/** A round, smiling sticker on a transparent background. 160 × 160. */
export const smileSticker = () => png(160, 160, (x, y) => {
  if (!near(x, y, 80, 80, 70)) return [0, 0, 0, 0];
  const eye = near(x, y, 56, 64, 9) || near(x, y, 104, 64, 9);
  const d = Math.hypot(x - 80, y - 82);
  const smile = y > 92 && d > 36 && d < 44;
  if (eye || smile) return [70, 46, 20, 255];
  return near(x, y, 80, 80, 64) ? [255, 204, 64, 255] : [230, 160, 30, 255];
});
