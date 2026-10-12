import { runGame } from './model.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pct = (a, f) => (100 * a.filter(f).length) / Math.max(1, a.length);

export function runBatch(strategy, { n = 500, params = {}, cards, seed0 = 1, noEvents = false } = {}) {
  const games = [];
  for (let i = 0; i < n; i++) games.push(runGame(strategy, { seed: seed0 + i, params, cards: typeof cards === 'function' ? cards(i) : cards, noEvents }));
  return games;
}

export function stats(games) {
  const day = (k, d) => mean(games.map((g) => (g.trace[d - 1] ? g.trace[d - 1][k] ?? 0 : 0)));
  return {
    n: games.length,
    mid: mean(games.map((g) => g.mid)),
    fin: mean(games.map((g) => g.fin)),
    total: mean(games.map((g) => g.mid + g.fin)),
    passMid: pct(games, (g) => g.passMid),
    passFin: pct(games, (g) => g.passFin),
    passBoth: pct(games, (g) => g.passMid && g.passFin),
    hospital: pct(games, (g) => g.hospital),
    bankrupt: pct(games, (g) => g.bankrupt),
    fever: pct(games, (g) => g.fevers > 0),
    debt10: day('debt', 10),
    progress: mean(games.map((g) => g.progress)),
    cupsEarly: mean(games.map((g) => mean(g.trace.slice(0, 3).map((t) => t.cups ?? 0)))),
    cupsLate: mean(games.map((g) => mean(g.trace.slice(6, 9).map((t) => t.cups ?? 0)))),
    cum: Array.from({ length: 10 }, (_, i) => day('progress', i + 1)),
    S: Array.from({ length: 10 }, (_, i) => day('S', i + 1)),
    maxStress: mean(games.map((g) => g.maxStress)),
  };
}

export const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
export const f0 = (x) => Math.round(x).toString();
