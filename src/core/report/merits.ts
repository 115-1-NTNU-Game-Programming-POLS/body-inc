import type { ReportFile } from '../content/generated.ts';

/** What a passed semester can be praised for, best teaching point first (design doc 8.11: "three things done right"). */
export const MERITS = ['liver_check', 'declined', 'early_bed', 'patrol', 'no_hospital', 'passed_fin', 'passed_mid'] as const;
export type MeritId = (typeof MERITS)[number];

/** The review's words by merit, as keys of the report bank's `doc`. */
export const MERIT_TEXT: Readonly<Record<MeritId, keyof ReportFile['doc']>> = {
  liver_check: 'reviewLiverCheck', declined: 'reviewDeclined', early_bed: 'reviewBed', patrol: 'reviewPatrol',
  no_hospital: 'reviewHospital', passed_fin: 'reviewFin', passed_mid: 'reviewMid',
};
