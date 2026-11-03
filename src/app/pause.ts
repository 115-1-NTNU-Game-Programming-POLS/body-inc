import {
  GAME_SPEEDS, NO_ASSISTS, TEXT_SCALES, type Assists, type AssistFlag, type ChapterState, type Settings, type TickInput,
} from '../core/index.ts';

/** The settings that pick one of a few values; the rest are on/off flags. */
export type ChoiceKey = 'textScale' | 'gameSpeed';

const CHOICES: { readonly [K in ChoiceKey]: readonly Settings[K][] } = { textScale: TEXT_SCALES, gameSpeed: GAME_SPEEDS };

/** The choices of a setting, in menu order. */
export const choicesOf = (key: ChoiceKey): readonly number[] => CHOICES[key];

/** The settings after moving `key` by `by` choices, wrapping at both ends. */
export function stepSetting(settings: Settings, key: ChoiceKey, by: 1 | -1): Settings {
  const list = CHOICES[key];
  const at = list.indexOf(settings[key] as never);
  return { ...settings, [key]: list[(Math.max(at, 0) + by + list.length) % list.length] };
}

export const toggleSetting = (settings: Settings, flag: AssistFlag): Settings => ({ ...settings, [flag]: !settings[flag] });

/** A setting value as the menu prints it: 0.8 is "80%", 1.25 is "125%". */
export const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** The speed the loop runs at; the rules never see it (design doc 5.7). */
export const speedOf = (settings: Settings | undefined): number => settings?.gameSpeed ?? 1;

/** The assists that change a fight, as a tick takes them; the other flags belong to the input and the view. */
export const assistsOf = (settings: Settings | undefined): Assists =>
  settings ? { halfDamage: settings.halfDamage, neverEmpty: settings.neverEmpty, autoPerfect: settings.autoPerfect } : NO_ASSISTS;

/** The input with the assists attached, and untouched when none is on, so a plain run records plain inputs. */
export function withAssists(input: TickInput, assists: Assists): TickInput {
  return assists.halfDamage || assists.neverEmpty || assists.autoPerfect ? { ...input, assists } : input;
}

/** A conversation, card, rescue or exam panel owns the keys and the room is frozen under it. */
export function panelOpen(state: ChapterState): boolean {
  return Boolean(state.dialogue || state.card || state.rescue || state.exam);
}
