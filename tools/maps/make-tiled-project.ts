/**
 * Writes body-inc.tiled-project from src/core/rooms/classes.ts, so every property in Tiled is
 * a dropdown or checkbox with the same defaults the parser applies (design doc 13.3).
 * Enemy types come from content/enemies.json; rerun after adding an enemy.
 *
 *   node tools/maps/make-tiled-project.ts            write the file
 *   node tools/maps/make-tiled-project.ts --check    exit 1 if the committed file is stale
 *
 * Object templates are not generated: a templated object stores its class and properties in
 * the template file, which neither Phaser nor the room parser resolves.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnemyTable } from '../../src/core/combat/enemies.ts';
import { OBJECT_CLASSES, ROOM_CLASS, type ClassSpec, type PropSpec } from '../../src/core/rooms/classes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'body-inc.tiled-project');

export function buildProject(enemyIds: readonly string[]): object {
  const enums = new Map<string, readonly string[]>([['EnemyType', enemyIds]]);
  const member = (name: string, s: PropSpec): object => {
    switch (s.type) {
      case 'enum':
        enums.set(s.enum, s.values);
        return { name, type: 'string', propertyType: s.enum, value: s.default };
      case 'ref':
        // Empty default, matching the parser: Tiled does not save a member left at its default, so
        // a default of a real enemy would show in the editor but read as missing in the game.
        return s.ref === 'enemy'
          ? { name, type: 'string', propertyType: 'EnemyType', value: '' }
          : { name, type: 'string', value: '' };
      case 'condition': return { name, type: 'string', value: '' };
      case 'object': return { name, type: 'object', value: 0 };
      default: return { name, type: s.type, value: s.default };
    }
  };
  const classOf = (name: string, spec: ClassSpec, useAs: string[], color: string) => ({
    name, type: 'class', useAs, color, drawFill: true,
    members: Object.entries(spec).map(([k, s]) => member(k, s)),
  });
  const classes = [
    classOf('Room', ROOM_CLASS, ['map'], '#ff808080'),
    classOf('Variant', { when: { type: 'condition', required: true } }, ['layer'], '#ffa070d0'),
    ...Object.entries(OBJECT_CLASSES).map(([k, spec]) => classOf(k, spec, ['object'], '#ff3080c0')),
  ];
  let id = 1;
  return {
    automappingRulesFile: '',
    commands: [],
    compatibilityVersion: 1100,
    extensionsPath: 'extensions',
    folders: ['public/assets/maps'],
    properties: [],
    propertyTypes: [
      ...[...enums].map(([name, values]) => ({ id: id++, name, type: 'enum', storageType: 'string', values, valuesAsFlags: false })),
      ...classes.map((c) => ({ id: id++, ...c })),
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const enemies = loadEnemyTable(JSON.parse(readFileSync(join(ROOT, 'content', 'enemies.json'), 'utf8')));
  const text = JSON.stringify(buildProject([...enemies.enemies.keys()]), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUT, 'utf8').replaceAll('\r\n', '\n'); } catch { /* missing counts as stale */ }
    if (current !== text) {
      console.log('body-inc.tiled-project is out of date; run node tools/maps/make-tiled-project.ts');
      process.exit(1);
    }
    console.log('tiled project: up to date');
  } else {
    writeFileSync(OUT, text);
    console.log(`tiled project -> ${OUT}`);
  }
}
