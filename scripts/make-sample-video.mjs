// Generates a small demo video with distinct scenes and tone bursts separated by pauses, using ffmpeg.
// Usage: npm run sample   (needs ffmpeg on PATH). Output: samples/demo.mp4
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

mkdirSync('samples', { recursive: true });
// ffmpeg's drawtext needs a font file; pick one that exists on this OS (override with FONT_FILE).
const FONT = [process.env.FONT_FILE, 'C:/Windows/Fonts/arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
  .filter(Boolean)
  .find((p) => existsSync(p))
  ?.replace(/^([A-Za-z]):/u, '$1\\:');
if (!FONT) throw new Error('No font found. Set FONT_FILE to a .ttf path.');
const scenes = [
  ['color=c=0x2e7d32:s=640x360:d=6', 'GREEN FIELD'],
  ['color=c=0x1565c0:s=640x360:d=6', 'BLUE SEA'],
  ['color=c=0xc62828:s=640x360:d=6', 'RED DOOR'],
];
const inputs = scenes.flatMap(([src]) => ['-f', 'lavfi', '-i', src]);
const filters = scenes
  .map(([, label], i) => `[${i}:v]drawtext=fontfile='${FONT}':text='${label}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2[v${i}]`)
  .join(';');
const concat = `${scenes.map((_, i) => `[v${i}]`).join('')}concat=n=${scenes.length}:v=1:a=0[v]`;
// Tone bursts (a stand-in for speech) with pauses between them.
const audio = "aevalsrc='0.4*sin(2*PI*220*t)*(lt(mod(t,6),2.5))':s=16000:d=18[a]";

const result = spawnSync(
  'ffmpeg',
  ['-y', ...inputs, '-filter_complex', `${filters};${concat};${audio}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', 'samples/demo.mp4'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
