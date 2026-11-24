import { describe, expect, it } from 'vitest';
import { createDemoSketch } from './demo';
import { calculateTransmissionSpeeds, gearMeshCenterDistance, migrateLegacyTransmission, tangentGearPosition, type Gear, type Transmission } from './transmission';

const gear = (id: string, axleId: string, teeth: number, x = 0, plane = 0): Gear => ({ id, name: id, axleId, toothCount: teeth, moduleMm: 0.8, pressureAngleDeg: 20, boreMm: 8, plane, x } as Gear);

describe('transmission model', () => {
  it('migrates a v1 route to a belt stage and retains pulley axle centers', () => {
    const sketch = createDemoSketch();
    const migrated = migrateLegacyTransmission(sketch);
    expect(migrated.belts[0]).toMatchObject({ id: 'B1', profile: 'GT2', route: sketch.route, toothCounts: { P1: 60, P2: 20 } });
    expect(migrated.axles.find(a => a.id === 'AX-P2')).toMatchObject({ x: 120, y: 0 });
  });
  it('places 24T module 0.8 gears tangent at 19.2mm and 24:96 at 48mm', () => {
    const p24 = gear('g1', 'a1', 24); const p96 = gear('g2', 'a2', 96);
    expect(gearMeshCenterDistance(p24, gear('g3', 'a3', 24))).toBeCloseTo(19.2);
    expect(gearMeshCenterDistance(p24, p96)).toBeCloseTo(48);
    expect(tangentGearPosition({ x: 0, y: 0 }, { x: 0, y: 2 }, p24, p96).y).toBeCloseTo(48);
  });
  it('propagates a compound belt and gear train with direction and ratio', () => {
    const transmission: Transmission = {
      axles: [{ id: 'axB', x: 100, y: 0, componentIds: ['B', 'B16'] }], belts: [
        { id: 'B1', profile: 'GT2', route: ['A', 'B', 'A'], toothCounts: { A: 20, B: 40 } },
        { id: 'B2', profile: 'HTD 5M', route: ['B16', 'C', 'B16'], toothCounts: { B16: 16, C: 48 } },
      ],
      gears: [gear('G24', 'a', 24), gear('G96', 'b', 96)], meshes: [{ id: 'M1', gearAId: 'G24', gearBId: 'G96', plane: 0 }],
    };
    const beltResult = calculateTransmissionSpeeds(transmission, 'A', 600);
    expect(beltResult.speeds.B).toBe(300);
    expect(beltResult.speeds.C).toBe(100);
    const gearResult = calculateTransmissionSpeeds(transmission, 'G24', 600);
    expect(gearResult.speeds.G96).toBe(-150);
    expect(gearResult.conflict).toBeNull();
  });
  it('carries 600 RPM through a 20:40 and 16:48 compound belt train', () => {
    const transmission: Transmission = {
      axles: [{ id: 'AX-B', x: 40, y: 0, componentIds: ['B40', 'B16'] }],
      belts: [
        { id: 'B1', profile: 'GT2', route: ['A20', 'B40', 'A20'], toothCounts: { A20: 20, B40: 40 } },
        { id: 'B2', profile: 'HTD 5M', route: ['B16', 'C48', 'B16'], toothCounts: { B16: 16, C48: 48 } },
      ], gears: [], meshes: [],
    };
    expect(calculateTransmissionSpeeds(transmission, 'A20', 600).speeds.C48).toBeCloseTo(100);
  });
});



it('keeps a three-gear train separate from a belt with a tensioner and an unfinished route', () => {
  const transmission: Transmission = {
    axles: [],
    gears: [gear('pinion','a',12), gear('middle','b',24), gear('output','c',48)],
    meshes: [
      { id:'m1', gearAId:'pinion', gearBId:'middle', plane:0 },
      { id:'m2', gearAId:'middle', gearBId:'output', plane:0 },
    ],
    belts: [
      { id:'belt', profile:'GT2', route:['p1','idler','p2','p1'], toothCounts:{p1:20,p2:40} },
      { id:'draft', profile:'GT2', route:['p2','pinion','middle'], toothCounts:{p2:40,pinion:12,middle:24} },
    ],
  };
  expect(calculateTransmissionSpeeds(transmission,'output',1).speeds).toEqual({output:1,middle:-2,pinion:4});
  expect(calculateTransmissionSpeeds(transmission,'p1',1).speeds).toEqual({p1:1,p2:0.5});
});
