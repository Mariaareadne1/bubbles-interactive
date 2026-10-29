// Records the live canvas through the app's recorder (ink included), saves it, and inspects it with ffprobe:
// node scripts/verify-recording.mjs [file]   (default: a fresh 4-second clip)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

mkdirSync('artifacts', { recursive: true });
let file = process.argv[2];
if (!file) {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5398/?showcase');
  await page.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => window.__bubbles && !window.__bubbles.store.get().loading, null, { timeout: 120000 });
  const out = await page.evaluate(async () => {
    const { recordCanvas } = await import('/src/capture/recorder.ts');
    const m = window.__bubbles;
    m.store.set({ uiHidden: true });
    setTimeout(() => m.app.pop(m.store.doc.bubbles[0].id), 1200);
    const rec = await recordCanvas(m.engine.canvas, { seconds: 4, ink: document.querySelector('svg.ink') });
    const buf = new Uint8Array(await rec.blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), type: rec.type, ext: rec.extension };
  });
  file = `artifacts/recording-test.${out.ext}`;
  writeFileSync(file, Buffer.from(out.b64, 'base64'));
  await browser.close();
}
const probe = execFileSync(ffprobe.path, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,avg_frame_rate:format=duration', '-of', 'default=nw=1', file]).toString();
console.log(file);
console.log(probe.trim());
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', file, '-vf', 'fps=1.2,scale=400:-1,tile=5x5', '-frames:v', '1', '-q:v', '4', 'artifacts/contact-sheet.jpg']);
console.log('artifacts/contact-sheet.jpg');
