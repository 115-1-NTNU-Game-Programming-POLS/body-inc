import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAudio, MAX_TRACK_BYTES } from '../../tools/check-audio.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MUSIC = 'public/assets/audio/music';
const dirs: string[] = [];

/** A copy of the files the check reads, with the music as small stand-ins that start like an MP3. */
function tree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'body-inc-audio-'));
  dirs.push(dir);
  const copy = (rel: string): void => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(dir, rel));
  };
  for (const rel of ['content/audio.json', 'docs/art/asset-license.csv', 'docs/audio/cues.md', 'README.md']) copy(rel);
  const audio = JSON.parse(readFileSync(join(ROOT, 'content/audio.json'), 'utf8'));
  mkdirSync(join(dir, MUSIC), { recursive: true });
  for (const t of Object.values<{ file: string }>(audio.music.tracks)) writeFileSync(join(dir, MUSIC, t.file), Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]));
  return dir;
}

const edit = (dir: string, rel: string, fn: (text: string) => string): void => {
  const path = join(dir, rel);
  writeFileSync(path, fn(readFileSync(path, 'utf8')));
};

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('audio files check (art direction 13.7)', () => {
  it('passes the real tree and a tree of stand-ins, so the broken cases below start from a healthy one', () => {
    expect(checkAudio(ROOT)).toEqual([]);
    expect(checkAudio(tree())).toEqual([]);
  });

  it('a file that differs from a track only in case is a stray, not that track', () => {
    // Linux serves run-amok.mp3 and Run-Amok.mp3 as two files, so the one the page asks for would be missing there.
    const dir = tree();
    rmSync(join(dir, MUSIC, 'run-amok.mp3'));
    writeFileSync(join(dir, MUSIC, 'Run-Amok.mp3'), Buffer.from('ID3....'));
    expect(checkAudio(dir).join('\n')).toMatch(/Run-Amok\.mp3：content\/audio\.json 沒有任何曲目使用/);
  });

  it('a track whose file is missing, too big or not an MP3', () => {
    const a = tree();
    rmSync(join(a, MUSIC, 'run-amok.mp3'));
    expect(checkAudio(a)).toEqual([expect.stringMatching(/run-amok\.mp3：曲目「boss」的檔案不存在/)]);

    const b = tree();
    writeFileSync(join(b, MUSIC, 'run-amok.mp3'), Buffer.concat([Buffer.from('ID3'), Buffer.alloc(MAX_TRACK_BYTES)]));
    expect(checkAudio(b)).toEqual([expect.stringMatching(/run-amok\.mp3：1500003 位元組，超過/)]);

    const c = tree();
    writeFileSync(join(c, MUSIC, 'run-amok.mp3'), Buffer.from('RIFF....WAVE'));
    expect(checkAudio(c)).toEqual([expect.stringMatching(/run-amok\.mp3：開頭不像 MP3/)]);

    const d = tree();
    writeFileSync(join(d, MUSIC, 'run-amok.mp3'), Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    expect(checkAudio(d)).toEqual([]);
  });

  it('a file in the music folder that no track names, whatever its extension or case', () => {
    for (const name of ['stray.mp3', 'STRAY.MP3', 'stray.ogg', 'Thumbs.db']) {
      const dir = tree();
      writeFileSync(join(dir, MUSIC, name), Buffer.from('ID3....'));
      expect(checkAudio(dir), name).toEqual([expect.stringContaining(`${name}：content/audio.json 沒有任何曲目使用`)]);
    }
  });

  it('a track with no license row, a blank credit, or a credit that does not name it', () => {
    const none = tree();
    edit(none, 'docs/art/asset-license.csv', (t) => t.split(/\r?\n/).filter((l) => !l.startsWith(`${MUSIC}/quirky-dog.mp3,`)).join('\r\n'));
    expect(checkAudio(none)).toEqual([expect.stringMatching(/沒有「public\/assets\/audio\/music\/quirky-dog\.mp3」的授權紀錄/)]);

    const blank = tree();
    edit(blank, 'docs/art/asset-license.csv', (t) => t.replace(/(quirky-dog\.mp3,.*,)Quirky Dog Kevin MacLeod[^\r\n]*/, '$1'));
    expect(checkAudio(blank).join('\n')).toMatch(/quirky-dog\.mp3」缺 credit_text/);

    const wrong = tree();
    edit(wrong, 'docs/art/asset-license.csv', (t) => t.replace(/Quirky Dog Kevin MacLeod/, 'Kevin MacLeod'));
    expect(checkAudio(wrong)).toEqual([expect.stringMatching(/credit_text 沒有曲名「Quirky Dog」/)]);
  });

  it('a source link that differs between the content and the license record', () => {
    const dir = tree();
    edit(dir, 'docs/art/asset-license.csv', (t) => t.replace('Quirky%20Dog.mp3', 'Quirky%20Dog%202.mp3'));
    expect(checkAudio(dir)).toEqual([expect.stringMatching(/quirky-dog\.mp3」的 source_url 與 content\/audio\.json 的 sourceUrl 不同/)]);
  });

  it('a cue sheet that leaves out a cue or a track, and a README that leaves out a credit', () => {
    const cue = tree();
    edit(cue, 'docs/audio/cues.md', (t) => t.replaceAll('`boing`', 'boing'));
    expect(checkAudio(cue)).toEqual([expect.stringMatching(/cues\.md：表格裡沒有音效「boing」的列/)]);

    const track = tree();
    edit(track, 'docs/audio/cues.md', (t) => t.replaceAll('`liver`', 'liver'));
    expect(checkAudio(track)).toEqual([expect.stringMatching(/cues\.md：表格裡沒有曲目「liver」的列/)]);

    // Naming a cue in the text, or in the second column of a row, is not having a row of its own.
    const mention = tree();
    edit(mention, 'docs/audio/cues.md', (t) => t.replace(/^\| `boing` \|/m, '| 彈開 `boing` |'));
    expect(checkAudio(mention)).toEqual([expect.stringMatching(/表格裡沒有音效「boing」的列/)]);

    // A cue whose id contains another's ("telegraph.1" within "telegraph.10") must not be covered by it.
    const prefix = tree();
    edit(prefix, 'docs/audio/cues.md', (t) => t.replace(/^\| `telegraph\.1` \|/m, '| `telegraph.10` |'));
    expect(checkAudio(prefix)).toEqual([expect.stringMatching(/表格裡沒有音效「telegraph\.1」的列/)]);

    const readme = tree();
    edit(readme, 'README.md', (t) => t.replaceAll('Easy Lemon', 'Easy'));
    expect(checkAudio(readme)).toEqual([expect.stringMatching(/README\.md：致謝沒有曲目「Easy Lemon」/)]);

    const gone = tree();
    rmSync(join(gone, 'docs/audio/cues.md'));
    expect(checkAudio(gone)).toEqual([expect.stringMatching(/cues\.md：找不到/)]);
  });
});
