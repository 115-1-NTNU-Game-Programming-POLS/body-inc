/**
 * The asset manifest (public/assets/manifest.json, art direction 13.5) is the only contract
 * between art and code: code asks for a logical key and tag, never a file.
 */
export interface ManifestEntry {
  readonly key: string;
  readonly category: string;
  readonly frame: readonly [number, number];
  readonly anchor: readonly [number, number];
  readonly tags: readonly { readonly name: string; readonly frames: number }[];
}

export interface Manifest {
  readonly version: number;
  readonly entries: readonly ManifestEntry[];
}

/** Aseprite JSON as exported with --format json-hash; only the parts checked here. */
export interface AsepriteJson {
  readonly frames: Readonly<Record<string, unknown>>;
  readonly meta: { readonly frameTags: readonly { readonly name: string; readonly from: number; readonly to: number }[] };
}

export const tagKey = (key: string, tag: string): string => `${key}.${tag}`;

/** public/assets/atlases/index.json, written by tools/art/make_placeholders.py: key -> path stem. */
export type AtlasIndex = Readonly<Record<string, string>>;

export function atlasUrls(index: AtlasIndex, key: string): { png: string; json: string } {
  const base = index[key];
  if (!base) throw new Error(`atlas index has no entry for "${key}"; rerun tools/art/make_placeholders.py`);
  return { png: `${base}.png`, json: `${base}.json` };
}

/**
 * Problems that would otherwise surface as a silent missing animation mid-game: a manifest tag
 * absent from the atlas, a wrong frame count, or frame names Phaser's createFromAseprite cannot
 * look up (it reads frames by index string, art direction 13.4).
 */
export function atlasProblems(entry: ManifestEntry, atlas: AsepriteJson): string[] {
  const problems: string[] = [];
  const tags = new Map(atlas.meta.frameTags.map((t) => [t.name, t]));
  for (const t of entry.tags) {
    const found = tags.get(tagKey(entry.key, t.name));
    if (!found) problems.push(`${entry.key}: missing tag ${tagKey(entry.key, t.name)}`);
    else if (found.to - found.from + 1 !== t.frames) {
      problems.push(`${entry.key}: ${t.name} has ${found.to - found.from + 1} frames, manifest says ${t.frames}`);
    }
  }
  const count = Object.keys(atlas.frames).length;
  for (let i = 0; i < count; i++) {
    if (!(String(i) in atlas.frames)) {
      problems.push(`${entry.key}: frame "${i}" not found; export with --filename-format "{frame}"`);
      break;
    }
  }
  return problems;
}
