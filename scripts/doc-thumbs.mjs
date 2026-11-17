// Doc thumbnails (#68): 800×500 WebP crops of the website shots in docs/site/img, used by README.md and the docs
// index (docs/img/thumb-*.webp). Wide shots are fitted and padded with the porcelain ground; tall cards are scaled and
// cropped from the top so their title shows. Fake data only (the shots come from the demo panel).
// Usage: `node scripts/doc-thumbs.mjs` after `npm run site:shots` (needs ffmpeg with libwebp).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const THUMBS = {
  agents: 'card-ai-diff', privacy: 'card-privacy', ask: 'card-ask', fallback: 'card-fallback',
  'photos-voice': 'card-photos-voice', usage: 'usage-desktop', quiet: 'card-quiet', mcp: 'card-mcp',
  'wa-group': 'card-wa-group', 'web-access': 'card-web-access', backups: 'backups-desktop',
  'small-server': 'card-small-server', assistants: 'card-assistants', checklist: 'card-checklist',
  overview: 'overview-desktop', phone: 'overview-mobile', whatsapp: 'card-wa-numbers', chats: 'card-chat-page',
};
const BG = '0xf1f2eb';

for (const [out, src] of Object.entries(THUMBS)) {
  const input = resolve(root, 'docs/site/img', `${src}.webp`);
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', input], { encoding: 'utf8' }).trim().split(',').map(Number);
  const vf = w / h < 0.95
    ? `scale=576:-2,crop=576:min(ih\\,476):0:0,pad=800:500:112:24:color=${BG}`
    : `scale=752:452:force_original_aspect_ratio=decrease,pad=800:500:(ow-iw)/2:(oh-ih)/2:color=${BG}`;
  const file = resolve(root, 'docs/img', `thumb-${out}.webp`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', vf, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', '-compression_level', '6', file]);
  console.log(`docs/img/thumb-${out}.webp ← ${src} (${w}×${h})`);
}
