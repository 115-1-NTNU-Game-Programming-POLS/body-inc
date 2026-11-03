/**
 * Builds public/assets/audio/music from the original downloads (docs/audio/cues.md, "Rebuilding").
 * Each track of content/audio.json is normalized to the same loudness (design doc 13.6) and encoded
 * as MP3 under the size budget of art direction 13.7. Needs ffmpeg with libmp3lame on the PATH.
 *
 *   node tools/audio/build-music.ts <folder with the original .mp3 files>
 *   node tools/audio/build-music.ts --verify      measures what is already built; exit 1 if off target
 *
 * A track longer than the budget allows at stereo 64 kbps goes to mono, and the bitrate is the
 * highest of a short ladder that fits, so quality is spent where the track is short.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets', 'audio', 'music');
/** Integrated loudness every track is brought to, and how far a built file may be from it. */
const TARGET_LUFS = -18;
const TOLERANCE = 1;
/** Art direction 13.7: at most 1.5 MB a track; the encoder is aimed a little under so a file never lands on the line. */
const BUDGET_BYTES = 1_500_000;
const AIM_BYTES = 1_450_000;
const LADDER = [
  { kbps: 96, channels: 2 }, { kbps: 80, channels: 2 }, { kbps: 64, channels: 2 },
  { kbps: 64, channels: 1 }, { kbps: 56, channels: 1 }, { kbps: 48, channels: 1 },
] as const;

interface Track { readonly file: string; readonly title: string; readonly artist: string; readonly sourceUrl: string }
const tracks = Object.entries(JSON.parse(readFileSync(join(ROOT, 'content', 'audio.json'), 'utf8')).music.tracks as Record<string, Track>);

function run(cmd: string, args: readonly string[]): { out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`could not run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr}`);
  return { out: r.stdout, err: r.stderr };
}

const seconds = (file: string): number => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).out.trim());

/** Highest rung of the ladder whose file fits under the aim. */
export function rungFor(duration: number): (typeof LADDER)[number] {
  return LADDER.find((r) => (r.kbps * 1000 * duration) / 8 <= AIM_BYTES) ?? LADDER[LADDER.length - 1]!;
}

/** Integrated loudness in LUFS, measured the way the second pass is told to be. */
function loudness(file: string): number {
  const { err } = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
  const m = [...err.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].at(-1);
  if (!m) throw new Error(`no loudness reading for ${file}`);
  return Number(m[1]);
}

function build(source: string, out: string, track: Track): void {
  const rung = rungFor(seconds(source));
  const mix = rung.channels === 1 ? 'pan=mono|c0=0.5*c0+0.5*c1,' : '';
  const norm = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const first = run('ffmpeg', ['-hide_banner', '-nostats', '-i', source, '-af', `${mix}${norm}:print_format=json`, '-f', 'null', '-']).err;
  const m = JSON.parse(first.slice(first.lastIndexOf('{'), first.lastIndexOf('}') + 1)) as Record<string, string>;
  const measured = `measured_I=${m['input_i']}:measured_TP=${m['input_tp']}:measured_LRA=${m['input_lra']}:measured_thresh=${m['input_thresh']}:offset=${m['target_offset']}`;
  run('ffmpeg', [
    '-hide_banner', '-nostats', '-y', '-i', source, '-vn', '-af', `${mix}${norm}:${measured}:linear=true,aresample=44100`,
    '-c:a', 'libmp3lame', '-b:a', `${rung.kbps}k`, '-ac', String(rung.channels), '-map_metadata', '-1',
    '-metadata', `title=${track.title}`, '-metadata', `artist=${track.artist}`, '-metadata', 'comment=incompetech.com, CC BY 4.0', out,
  ]);
  console.log(`${basename(out)}: ${rung.channels === 1 ? 'mono' : 'stereo'} ${rung.kbps} kbps`);
}

function report(): number {
  let bad = 0;
  for (const [id, t] of tracks) {
    const file = join(OUT, t.file);
    if (!existsSync(file)) { console.log(`${id}: ${t.file} is missing`); bad++; continue; }
    const bytes = statSync(file).size;
    const lufs = loudness(file);
    const problems = [
      bytes > BUDGET_BYTES ? `${bytes} bytes is over the ${BUDGET_BYTES} budget` : '',
      Math.abs(lufs - TARGET_LUFS) > TOLERANCE ? `${lufs} LUFS is not within ${TOLERANCE} of ${TARGET_LUFS}` : '',
    ].filter(Boolean);
    console.log(`${id}: ${(bytes / 1e6).toFixed(2)} MB, ${lufs} LUFS${problems.length ? `  <-- ${problems.join('; ')}` : ''}`);
    if (problems.length) bad++;
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: node tools/audio/build-music.ts <folder of originals> | --verify'); process.exit(2); }
  if (arg !== '--verify') {
    mkdirSync(OUT, { recursive: true });
    for (const [, t] of tracks) {
      const source = join(arg, decodeURIComponent(basename(new URL(t.sourceUrl).pathname)));
      if (!existsSync(source)) throw new Error(`the original ${source} is not there; download it from ${t.sourceUrl}`);
      build(source, join(OUT, t.file), t);
    }
  }
  const bad = report();
  process.exit(bad === 0 ? 0 : 1);
}
