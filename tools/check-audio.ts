/**
 * Audio files check (art direction 13.7). The tracks content/audio.json names must be in
 * public/assets/audio/music, each within the 1.5 MB a track may weigh, each with a license row
 * that carries its credit line, and every cue and track must be in the cue sheet. A file no track
 * names is a problem too, so nothing ships by accident. Messages are Chinese because the people
 * who add sound read them on the pull request.
 *
 *   node tools/check-audio.ts [rootDir]     exit 1 on any problem
 *
 * Loudness is not checked here, since it needs ffmpeg: `node tools/audio/build-music.ts --verify`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/core/dialogue/csv.ts';
import { readContent } from '../src/core/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The most a track may weigh, in bytes (art direction 13.7: at most 1.5 MB). */
export const MAX_TRACK_BYTES = 1_500_000;
const MUSIC_DIR = 'public/assets/audio/music';
const LICENSES = 'docs/art/asset-license.csv';
const CUE_SHEET = 'docs/audio/cues.md';

const read = (file: string): string => readFileSync(file, 'utf8').replace(/^﻿/, '');

/** True when the bytes start like an MP3: an ID3 tag, or a frame sync. */
function looksLikeMp3(bytes: Buffer): boolean {
  if (bytes.length < 4) return false;
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3') return true;
  return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

export function checkAudio(rootDir = ROOT): string[] {
  const root = resolve(rootDir);
  const out: string[] = [];
  const audioFile = join(root, 'content', 'audio.json');
  if (!existsSync(audioFile)) return [`content/audio.json：找不到`];
  const audio = readContent('audio', JSON.parse(read(audioFile)));
  const tracks = Object.entries(audio.music.tracks);

  const musicDir = join(root, MUSIC_DIR);
  // Whatever the extension or case: a track under another name, or a stray file, must not ship by accident.
  const onDisk = existsSync(musicDir) ? readdirSync(musicDir) : [];
  const named = new Set(tracks.map(([, t]) => t.file));
  for (const name of onDisk) if (!named.has(name)) out.push(`${MUSIC_DIR}/${name}：content/audio.json 沒有任何曲目使用這個檔案，請登記或移除`);

  const licenseFile = join(root, LICENSES);
  const rows = existsSync(licenseFile) ? parseCsv(read(licenseFile)) : [];
  const header = rows[0] ?? [];
  const col = (name: string): number => header.indexOf(name);
  const byPath = new Map(rows.slice(1).map((r) => [r[col('path')] ?? '', r]));

  for (const [id, track] of tracks) {
    const rel = `${MUSIC_DIR}/${track.file}`;
    const path = join(root, rel);
    if (!existsSync(path)) {
      out.push(`${rel}：曲目「${id}」的檔案不存在`);
    } else {
      const size = statSync(path).size;
      if (size > MAX_TRACK_BYTES) out.push(`${rel}：${size} 位元組，超過每首 ${MAX_TRACK_BYTES} 位元組的上限`);
      if (!looksLikeMp3(readFileSync(path).subarray(0, 4))) out.push(`${rel}：開頭不像 MP3`);
    }
    const row = byPath.get(rel);
    if (!row) {
      out.push(`${LICENSES}：沒有「${rel}」的授權紀錄`);
      continue;
    }
    if ((row[col('credit_text')] ?? '').trim() === '') out.push(`${LICENSES}：「${rel}」缺 credit_text，CC BY 需要標示出處`);
    if (!(row[col('credit_text')] ?? '').includes(track.title)) out.push(`${LICENSES}：「${rel}」的 credit_text 沒有曲名「${track.title}」`);
    if (row[col('source_url')] !== track.sourceUrl) out.push(`${LICENSES}：「${rel}」的 source_url 與 content/audio.json 的 sourceUrl 不同`);
  }

  const sheetFile = join(root, CUE_SHEET);
  if (!existsSync(sheetFile)) {
    out.push(`${CUE_SHEET}：找不到，請寫出每個音效和每首曲目用在哪裡`);
  } else {
    // A row of a table, not a mention in the text: the id opens the line, so the sheet says what the sound is for.
    const listed = new Set([...read(sheetFile).matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!));
    for (const id of Object.keys(audio.cues)) if (!listed.has(id)) out.push(`${CUE_SHEET}：表格裡沒有音效「${id}」的列`);
    for (const id of Object.keys(audio.music.tracks)) if (!listed.has(id)) out.push(`${CUE_SHEET}：表格裡沒有曲目「${id}」的列`);
  }

  const readme = existsSync(join(root, 'README.md')) ? read(join(root, 'README.md')) : '';
  for (const [, track] of tracks) if (!readme.includes(track.title)) out.push(`README.md：致謝沒有曲目「${track.title}」（CC BY 要求標示）`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkAudio(process.argv[2] ?? ROOT);
  for (const p of problems) console.error(p);
  console.log(`audio check: ${problems.length} problem(s)`);
  process.exit(problems.length === 0 ? 0 : 1);
}
