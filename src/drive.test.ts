import { describe, expect, it } from 'vitest';
import { calculateDrive } from './drive';
import { createEmptySketch } from './demo';

function belt() {
  return {
    ...createEmptySketch(),
    pulleys: [20, 40, 60].map((toothCount, index) => ({
      id: `P${index + 1}`, label: `P${index + 1}`, toothCount, profile: 'GT2' as const,
      x: index * 100, y: index === 2 ? 100 : 0, isOrigin: index === 0,
    })),
    idlers: [{ id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 10 }],
    route: ['P1', 'T1', 'P2', 'P3', 'P1'],
  };
}

describe('pulley drive calculations', () => {
  it('reduces 3000 RPM from 20 teeth to 60 teeth to 1000 RPM', () => {
    const result = calculateDrive(belt(), 'P1', 'P3', 3000);
    expect(result).toMatchObject({ reduction: 3, speedMultiplier: 1 / 3, idealTorqueMultiplier: 3, outputRpm: 1000 });
    expect(result?.speeds).toEqual([
      { id: 'P1', multiplier: 1, rpm: 3000 },
      { id: 'P2', multiplier: 0.5, rpm: 1500 },
      { id: 'P3', multiplier: 1 / 3, rpm: 1000 },
    ]);
  });

  it('calculates an overdrive without requiring an RPM', () => {
    expect(calculateDrive(belt(), 'P3', 'P1', null)).toMatchObject({ reduction: 1 / 3, speedMultiplier: 3, outputRpm: null });
  });

  it('excludes idlers and disconnected pulleys from the synchronous drive', () => {
    const sketch = belt();
    sketch.pulleys.push({ ...sketch.pulleys[0]!, id: 'P4', label: 'P4', isOrigin: false, x: 400 });
    expect(calculateDrive(sketch, 'T1', 'P3', 3000)).toBeNull();
    expect(calculateDrive(sketch, 'P1', 'P4', 3000)).toBeNull();
    expect(calculateDrive({ ...sketch, route: ['P1', 'P2'] }, 'P1', 'P2', 3000)).toBeNull();
  });

  it('rejects invalid tooth counts and invalid RPM instead of producing infinity', () => {
    const sketch = belt();
    sketch.pulleys[0]!.toothCount = 0;
    expect(calculateDrive(sketch, 'P1', 'P3', 3000)).toBeNull();
    expect(calculateDrive(belt(), 'P1', 'P3', -1)).toBeNull();
    expect(calculateDrive(belt(), 'P1', 'P3', Number.NaN)).toBeNull();
  });
});
