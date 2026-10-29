// Regenerates the documentation media in docs/media from the running dev server.
// node scripts/gallery.mjs [--no-demo]
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

const run = (args, env = {}) => execFileSync('node', args, { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } }).toString().trim();
const ff = (args) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args]);
const jpg = (src, out, extra = []) => ff(['-i', src, ...extra, '-q:v', '3', out]);
mkdirSync('docs/media', { recursive: true });

// the whole garden, and on a phone
run(['scripts/shoot.mjs', 'g-garden', 'showcase', '1600', '1000', '7000']);
jpg('artifacts/g-garden.png', 'docs/media/01-garden.jpg');
run(['scripts/shoot.mjs', 'g-mobile', 'showcase', '390', '844', '7000']);
jpg('artifacts/g-mobile.png', 'docs/media/08-mobile.jpg');

// close-ups of bubbles over light and dark parts of the garden, and the film over time
run(['scripts/closeup.mjs', 'g-close-light', 'show-b3', '6'], { QUERY: 'showcase', W: '700', H: '560' });
run(['scripts/closeup.mjs', 'g-close-dark', 'show-b1', '8'], { QUERY: 'showcase', W: '700', H: '560' });
ff(['-i', 'artifacts/g-close-light.png', '-i', 'artifacts/g-close-dark.png', '-filter_complex', 'hstack=inputs=2', '-q:v', '3', 'docs/media/02-bubble-closeups.jpg']);
run(['scripts/closeup.mjs', 'g-film', 'show-b4', '7', '6', '1.5'], { QUERY: 'showcase', W: '480', H: '420' });
ff([...[0, 1, 2, 3, 4, 5].flatMap((i) => ['-i', `artifacts/g-film-${i}.png`]), '-filter_complex', 'xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0', '-q:v', '3', 'docs/media/03-film-over-time.jpg']);

// the pop, frame by frame
run(['scripts/pop.mjs', 'g-pop', '0']);
jpg('artifacts/g-pop.png', 'docs/media/04-pop-strip.jpg', ['-vf', 'scale=1600:-1']);

// the six passengers, asleep and awake
run(['scripts/passengers.mjs', 'g-pass']);
jpg('artifacts/g-pass.png', 'docs/media/05-passengers.jpg');

if (!process.argv.includes('--no-demo')) {
  run(['scripts/demo.mjs', '1600', '900']);
  const src = existsSync('artifacts/bubbles-demo.mp4') ? 'artifacts/bubbles-demo.mp4' : 'artifacts/bubbles-demo.webm';
  ff(['-i', src, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', 'docs/media/bubbles-demo.mp4']);
  ff(['-i', src, '-vf', 'fps=1.3,scale=400:-1,tile=5x5', '-frames:v', '1', '-q:v', '4', 'docs/media/demo-contact-sheet.jpg']);
  ff(['-sseof', '-0.5', '-i', src, '-frames:v', '1', '-q:v', '3', 'docs/media/demo-end.jpg']);
}
console.log('docs/media updated');
