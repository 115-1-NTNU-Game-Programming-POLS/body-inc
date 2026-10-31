import type { Settings } from '../core/index.ts';

/**
 * The presentation mode (ux-spec 6.1): larger text and letters on the options, so the audience can
 * vote by raising a hand. It lives in the registry only, under this key, and holds the settings to
 * give back; nothing of it is saved.
 */
export const PRESENTER_KEY = 'presenter';

export interface Presenter {
  readonly before: Settings;
}

export const presenterSettings = (settings: Settings): Settings => ({ ...settings, textScale: 1.25 });

/** The mark on the badge of option `i`: A, B, C while presenting, else 1, 2, 3. */
export const optionMark = (i: number, presenting: boolean): string => (presenting ? String.fromCharCode(65 + i) : String(i + 1));
