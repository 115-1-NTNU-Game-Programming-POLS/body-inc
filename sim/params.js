// The numbers live in content/params.json, shared with the game (docs/architecture.md section 7).
// This module keeps the exports the sim scripts already import.
import { readFileSync } from 'node:fs';

const file = JSON.parse(readFileSync(new URL('../content/params.json', import.meta.url), 'utf8'));

export const DEFAULTS = file.defaults;
export const DIFFICULTY = file.difficulty;
export const DISRUPTIVE_CARDS = file.semesterCards.disruptive;
export const CARDS = [...file.semesterCards.regular, ...DISRUPTIVE_CARDS];
