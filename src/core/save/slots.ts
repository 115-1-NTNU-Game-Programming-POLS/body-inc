import type { SlotDef } from './save.ts';

/**
 * Player settings. Text scale is the 100% / 125% choice of art direction 8.2; game speed 0.8
 * is the "flexible hours" assist of the design doc. Cross-run progress, the semester run and
 * story progress (design doc 13.5) get their own slots when those systems exist.
 */
export interface Settings {
  readonly textScale: 1 | 1.25;
  readonly gameSpeed: 1 | 0.8;
}

export const SETTINGS: SlotDef<Settings> = {
  name: 'settings',
  version: 1,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['textScale', 'gameSpeed'],
    properties: {
      textScale: { enum: [1, 1.25] },
      gameSpeed: { enum: [1, 0.8] },
    },
  },
  defaults: () => ({ textScale: 1, gameSpeed: 1 }),
  migrations: {},
};

export const SLOTS = [SETTINGS] as const;
