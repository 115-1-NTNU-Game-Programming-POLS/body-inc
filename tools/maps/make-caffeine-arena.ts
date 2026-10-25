/**
 * Writes the greybox arena of the caffeine boss (public/assets/maps/greybox/caffeine-arena.tmj),
 * the build-plan P4 room. A boss arena is one standard room with no north socket (art direction
 * 7.1); the boss stands far enough from the north wall to leave 40 px above his head for the
 * proposal sheet (art direction 5.5). The real arena is the brain chapter's fourth floor (P7).
 *
 *   node tools/maps/make-caffeine-arena.ts
 */
import { shell, tileLayer, W, writeRoom } from './room-kit.ts';

const { floor, walls, set, tileset } = shell('brain', 19);

// Entered from the south socket at columns 9-10; the greybox chapter also reaches it through the
// west socket at rows 6-7, because the brain corridor has no north door to meet the south one.
walls[11 * W + 9] = 0; walls[11 * W + 10] = 0;
set(walls, 8, 11, 'walltop-outer-ne'); set(walls, 11, 11, 'walltop-outer-nw');
walls[6 * W] = 0; walls[7 * W] = 0;
set(walls, 0, 5, 'walltop-outer-se'); set(walls, 0, 8, 'walltop-outer-ne');

writeRoom('greybox/caffeine-arena.tmj', {
  type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
  infinite: false, width: W, height: 12, tilewidth: 32, tileheight: 32, nextlayerid: 4, nextobjectid: 5, class: 'Room',
  properties: [
    { name: 'organ', type: 'string', value: 'brain' },
    { name: 'role', type: 'string', value: 'core' },
    { name: 'estSeconds', type: 'int', value: 180 },
    { name: 'storyOnly', type: 'bool', value: true },
  ],
  layers: [
    tileLayer(1, 'floor', floor),
    tileLayer(2, 'walls', walls),
    {
      id: 3, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown',
      objects: [
        { id: 1, name: 'start', type: 'PlayerStart', x: 320, y: 320, width: 0, height: 0, rotation: 0, visible: true, point: true },
        {
          id: 2, name: 'door-s', type: 'Door', x: 9 * 32, y: 11 * 32, width: 64, height: 32, rotation: 0, visible: true,
          // Locked in the greybox chapter, which enters through the west door; the brain chapter opens it.
          properties: [{ name: 'socket', type: 'string', propertytype: 'Socket', value: 'S' }, { name: 'lock', type: 'string', propertytype: 'Lock', value: 'key' }],
        },
        {
          id: 4, name: 'door-w', type: 'Door', x: 0, y: 6 * 32, width: 32, height: 64, rotation: 0, visible: true,
          properties: [{ name: 'socket', type: 'string', propertytype: 'Socket', value: 'W' }],
        },
        {
          id: 3, name: 'caffeine', type: 'Spawn', x: 320, y: 168, width: 0, height: 0, rotation: 0, visible: true, point: true,
          properties: [{ name: 'enemyType', type: 'string', propertytype: 'EnemyType', value: 'caffeine' }],
        },
      ],
    },
  ],
  tilesets: [tileset],
});
