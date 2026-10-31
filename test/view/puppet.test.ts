import { describe, expect, it } from 'vitest';
import { PUPPET_HOP_PX, PUPPET_PERIOD_MS, PUPPET_SWAY_DEG, puppetPose } from '../../src/view/actors/puppet.ts';

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
