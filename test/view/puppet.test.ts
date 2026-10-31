import { describe, expect, it } from 'vitest';
import { PUPPET_HOP_PX, PUPPET_PERIOD_MS, PUPPET_SWAY_DEG, puppetPose, puppetSway } from '../../src/view/actors/puppet.ts';

const samples = Array.from({ length: 4001 }, (_, i) => puppetPose(i * 0.5));

describe('paper-puppet pose', () => {
  it('sets off upright and on the ground', () => {
    expect(puppetPose(0).angle).toBeCloseTo(0);
    expect(puppetPose(0).hop).toBe(0);
  });

  it('sways plus and minus 4 degrees with a 0.4 s period', () => {
    expect(PUPPET_SWAY_DEG).toBe(4);
    expect(PUPPET_PERIOD_MS).toBe(400);
    expect(puppetPose(100).angle).toBeCloseTo(4);
    expect(puppetPose(300).angle).toBeCloseTo(-4);
    expect(puppetPose(400).angle).toBeCloseTo(0);
    expect(puppetPose(1234).angle).toBeCloseTo(puppetPose(1234 + 400).angle);
    expect(Math.max(...samples.map((p) => Math.abs(p.angle)))).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('lifts at most 2 px, peaking once per step, two steps per sway', () => {
    expect(Math.min(...samples.map((p) => p.hop))).toBe(0);
    expect(Math.max(...samples.map((p) => p.hop))).toBe(PUPPET_HOP_PX);
    expect(puppetPose(100).hop).toBe(PUPPET_HOP_PX);
    expect(puppetPose(300).hop).toBe(PUPPET_HOP_PX);
    expect(puppetPose(200).hop).toBe(0);
    // Rising edges to the peak within one period (0 to 400 ms): one per step.
    const period = samples.filter((_, i) => i * 0.5 < 400);
    const rises = period.filter((p, i) => i > 0 && p.hop === PUPPET_HOP_PX && period[i - 1]!.hop < PUPPET_HOP_PX);
    expect(rises).toHaveLength(2);
  });
});

describe('when a puppet sways', () => {
  const walking = { phase: 'idle', frozen: 0 } as const;
  // 100 ms into a walk is the far end of the sway: 4 degrees and the full hop.
  const at100 = (enemy: { phase: 'idle' | 'windup' | 'strike' | 'recover'; frozen: number }, moving = true, motion: string | undefined = 'puppet') =>
    puppetSway(1000, 1100, motion, moving, enemy);

  it('sways and lifts a walking puppet', () => {
    const s = at100(walking);
    expect(s.angle).toBeCloseTo(4);
    expect(s.dy).toBe(-PUPPET_HOP_PX);
    expect(s.since).toBe(1000);
    expect(at100({ phase: 'recover', frozen: 0 }).angle).toBeCloseTo(4);
  });

  it('keeps windup, strike and hurt upright, even while moving', () => {
    for (const enemy of [{ phase: 'windup', frozen: 0 }, { phase: 'strike', frozen: 0 }, { phase: 'idle', frozen: 3 }] as const) {
      expect(at100(enemy)).toEqual({ since: undefined, angle: 0, dy: 0 });
    }
  });

  it('keeps a standing puppet and every non-puppet upright', () => {
    expect(at100(walking, false)).toEqual({ since: undefined, angle: 0, dy: 0 });
    expect(puppetSway(1000, 1100, undefined, true, walking)).toEqual({ since: undefined, angle: 0, dy: 0 });
  });

  it('starts each walk upright, timed from its own first frame', () => {
    const first = puppetSway(undefined, 5000, 'puppet', true, walking);
    expect(first.since).toBe(5000);
    expect(first.angle).toBeCloseTo(0);
    expect(puppetSway(first.since, 5100, 'puppet', true, walking).angle).toBeCloseTo(4);
    const stopped = puppetSway(5000, 5150, 'puppet', false, walking);
    expect(puppetSway(stopped.since, 5175, 'puppet', true, walking)).toMatchObject({ since: 5175, dy: 0 });
  });
});
