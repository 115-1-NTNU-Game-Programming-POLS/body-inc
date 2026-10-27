import type { DayView, FloorId, Light, Strategy } from '../../src/core/index.ts';

/**
 * Player archetypes for the semester prototype, as strategies over the same view a player gets.
 * They are not a balance claim: the numbers of design doc 8.4 are first versions, and the point
 * of the archetypes is to push the building into states that the invariants must survive.
 */

const RANK: Record<Light, number> = { off: 0, yellow: 1, orange: 2, red: 3 };

const litBrightestFirst = (view: DayView): FloorId[] =>
  view.panel.buttons.filter((b) => RANK[b.light] > 0).sort((a, b) => RANK[b.light] - RANK[a.light]).map((b) => b.floor);

/** The floor a careful player picks from the lights alone; the routine marker, else the brain, when nothing is lit. */
const brightest = (view: DayView): FloorId => litBrightestFirst(view)[0] ?? view.panel.routine ?? 'brain';

interface Options {
  readonly bed: number;
  readonly lateNight: 'study' | 'rest';
  readonly coffee: boolean;
  /** Reads the liver clues (the stomach jam) and patrols the liver on them. */
  readonly readsLiver: boolean;
  /** Adds an overtime patrol of the next lit floor, at the price of an hour of sleep. */
  readonly overtime: boolean;
  readonly bbq: string;
  readonly deadline: string;
  readonly lateSnack: string;
  /** Bed on the eve of an exam. */
  readonly examEveBed?: number;
  /** Always patrols this floor, however the lights read. */
  readonly fixedPatrol?: FloorId;
  /** Hours of the day's cups; the default is one cup an hour after waking. */
  readonly coffeeAt?: (wake: number) => number[];
}

function archetype(o: Options): Strategy {
  return {
    plan(view) {
      return { coffee: o.coffee ? (o.coffeeAt ?? ((wake) => [wake + 1]))(view.wake) : [], rest: view.weekend ? [13, 17, 21] : [17, 21] };
    },
    choose(id) {
      return { bbq: o.bbq, deadline: o.deadline, late_snack: o.lateSnack }[id] ?? 'decline';
    },
    floor(view) {
      const hot = view.panel.buttons.some((b) => RANK[b.light] >= RANK.orange);
      const patrol = o.fixedPatrol ?? (o.readsLiver && view.liverClues.stomachJam && !hot ? 'liver' : brightest(view));
      if (!o.overtime) return { patrol };
      return { patrol, overtime: litBrightestFirst(view).find((f) => f !== patrol) ?? (patrol === 'gut' ? 'immune' : 'gut') };
    },
    night(view) {
      const bed = view.examTomorrow && o.examEveBed !== undefined ? o.examEveBed : o.bed;
      return { bed, nextWake: view.weekend && view.sleepDebt > 0.5 ? 9 : 7, lateNight: o.lateNight };
    },
  };
}

export const ARCHETYPES = {
  /** 22:30 bed, a morning cup, declines the barbecue, reads the clues. */
  balanced: archetype({ bed: 22.5, lateNight: 'rest', coffee: true, readsLiver: true, overtime: false, bbq: 'decline', deadline: 'squeeze', lateSnack: 'no', examEveBed: 22 }),
  /** 01:00 bed, studies late, works the deadline and the elevator overtime, goes for the snack. */
  nightOwl: archetype({ bed: 25, lateNight: 'study', coffee: false, readsLiver: false, overtime: true, bbq: 'decline', deadline: 'overtime', lateSnack: 'go' }),
  /** Healthy otherwise, but binges on an empty stomach at every barbecue and never looks at the liver. */
  drinkerBlind: archetype({ bed: 22.5, lateNight: 'rest', coffee: true, readsLiver: false, overtime: false, bbq: 'binge', deadline: 'squeeze', lateSnack: 'no', examEveBed: 22 }),
  /** The same drinker, who goes to the liver as soon as its clues show. */
  /** Cram: 01:00 bed, late cups, a snack every night, the deadline worked through, and the elevator always sent to the immune floor. */
  crammer: archetype({ bed: 25, lateNight: 'study', coffee: true, coffeeAt: (wake) => [wake + 1, 21], readsLiver: false, overtime: false, fixedPatrol: 'immune', bbq: 'decline', deadline: 'overtime', lateSnack: 'go' }),
  /** Cram without the study: 01:00 bed spent resting, late cups, a snack every night. */
  insomniac: archetype({ bed: 25, lateNight: 'rest', coffee: true, coffeeAt: (wake) => [wake + 1, 21], readsLiver: false, overtime: false, fixedPatrol: 'immune', bbq: 'decline', deadline: 'overtime', lateSnack: 'go' }),
  /** Drinks at every barbecue, but eats first. */
  drinkerFed: archetype({ bed: 22.5, lateNight: 'rest', coffee: true, readsLiver: false, overtime: false, bbq: 'drink', deadline: 'squeeze', lateSnack: 'no', examEveBed: 22 }),
  /** Every barbecue, the late bedtime and the late cups together. */
  partier: archetype({ bed: 25, lateNight: 'rest', coffee: true, coffeeAt: (wake) => [wake + 1, 21], readsLiver: false, overtime: false, fixedPatrol: 'immune', bbq: 'drink', deadline: 'overtime', lateSnack: 'go' }),
  drinkerInformed: archetype({ bed: 22.5, lateNight: 'rest', coffee: true, readsLiver: true, overtime: false, bbq: 'binge', deadline: 'squeeze', lateSnack: 'no', examEveBed: 22 }),
} as const satisfies Record<string, Strategy>;

export type ArchetypeName = keyof typeof ARCHETYPES;
