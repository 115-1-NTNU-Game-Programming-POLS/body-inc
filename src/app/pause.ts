import {
  GAME_SPEEDS, NO_ASSISTS, selectTool, TEXT_SCALES, type Assists, type AssistFlag, type ChapterState, type Settings, type TickInput,
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

/**
 * Whether the attack key is a toggle this tick. The folder swings on a press and guards while held, so an attack
 * held by the toggle would lock it into the guard: only the stapler toggles. A panel owns the keys.
 */
export const togglesAttack = (settings: Settings | undefined, state: ChapterState): boolean =>
  settings?.toggleAttack === true && !panelOpen(state) && selectTool(state.game).tool === 'stapler';

/** What stands between a key press and the handbook or the Esc menu opening. */
export interface OverlayGate {
  readonly repeat: boolean;
  readonly leaving: boolean;
  /** One was asked for in this frame and has not started yet: scene launches are queued, so it is not active. */
  readonly asked: boolean;
  readonly panel: boolean;
  /** The handbook or the menu is already showing. */
  readonly shown: boolean;
}

export const mayOpenOverlay = (gate: OverlayGate): boolean => !(gate.repeat || gate.leaving || gate.asked || gate.panel || gate.shown);
