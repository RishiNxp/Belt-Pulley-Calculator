import { describe, expect, it } from 'vitest';
import { createDemoSketch, createEmptySketch } from './demo';
import { loadSketch, parseSketchJson, saveSketch, STORAGE_KEY } from './persistence';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

describe('sketch persistence', () => {
  it('sketchPersistenceRoundTrips', () => {
    const storage = memoryStorage();
    const sketch = createDemoSketch();
    saveSketch(storage, sketch);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({ version: 1 });
    expect(loadSketch(storage)).toMatchObject({ ...sketch, activeBeltId: 'B1', transmission: { belts: [{ id: 'B1', route: sketch.route, profile: 'GT2' }] } });
    expect(parseSketchJson(JSON.stringify({ version: 1, sketch }))).toMatchObject({ activeBeltId: 'B1', transmission: { belts: [{ id: 'B1', route: sketch.route }] } });
  });

  it('importRejectsMalformedOrUnsupportedSketch', () => {
    expect(() => parseSketchJson('{')).toThrow(/json/i);
    expect(() => parseSketchJson(JSON.stringify({ version: 4, sketch: createDemoSketch() }))).toThrow(/version/i);
    const invalidRoute = createDemoSketch();
    invalidRoute.route[1] = 'P99';
    expect(() => parseSketchJson(JSON.stringify({ version: 1, sketch: invalidRoute }))).toThrow(/route|P99/i);
  });

  it('importRejectsDuplicateIdsAcrossSketchEntities', () => {
    const objectCollision = createDemoSketch();
    objectCollision.dimensions.push({
      id: 'P1',
      fromId: 'P1',
      kind: 'horizontal',
      valueMm: 20,
      offsetMm: 18,
    });
    expect(() => parseSketchJson(JSON.stringify(objectCollision))).toThrow(/id|appears|more than once/i);

    const relationCollision = createDemoSketch();
    relationCollision.dimensions.push({
      id: 'D1',
      fromId: 'P1',
      kind: 'horizontal',
      valueMm: 20,
      offsetMm: 18,
    });
    relationCollision.constraints.push({ id: 'D1', firstId: 'P1', secondId: 'P2', kind: 'horizontal' });
    expect(() => parseSketchJson(JSON.stringify(relationCollision))).toThrow(/id|appears|more than once/i);
  });

  it('keeps the app usable when browser storage rejects a write', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('Storage quota exceeded'); } };
    expect(() => saveSketch(storage, createDemoSketch())).not.toThrow();
  });

  it('loads legacy sketches without losing geometry and supplies empty drive preferences', () => {
    const old = createDemoSketch();
    delete old.drive;
    const loaded = parseSketchJson(JSON.stringify(old));
    expect(loaded.pulleys).toEqual(old.pulleys);
    expect(loaded.route).toEqual(old.route);
    expect(loaded.drive).toEqual({ driverId: null, outputId: null, driverRpm: null });
  });
  it('round trips a gear-only assembly with its axle, mesh angle, and relationship', () => {
    const storage = memoryStorage();
    const sketch = createEmptySketch();
    const gear = (id: string, axleId: string) => ({ id, name: id, axleId, plane: 0, toothCount: 24, moduleMm: 0.8, pressureAngleDeg: 20, boreMm: 8 });
    sketch.transmission = {
      axles: [
        { id: 'AX-G1', x: -20, y: 0, componentIds: ['G1'] },
        { id: 'AX-G2', x: -0.8, y: 0, componentIds: ['G2'] },
      ], belts: [], gears: [gear('G1', 'AX-G1'), gear('G2', 'AX-G2')],
      meshes: [{ id: 'M1', gearAId: 'G1', gearBId: 'G2', plane: 0, angleDeg: 0 }],
    };
    saveSketch(storage, sketch);
    expect(loadSketch(storage).transmission).toEqual(sketch.transmission);
  });
});
it('restores an unfinished one-pulley route, current pulley teeth and drive assumptions', () => {
  const sketch = createDemoSketch();
  sketch.route = ['P1'];
  const belt = sketch.transmission!.belts[0]!;
  belt.route = ['P1'];
  belt.toothCounts.P1 = 16;
  sketch.drive = { driverId: null, outputId: null, driverRpm: 120, diameter: '96', efficiency: '85', torque: '0.8' };
  const loaded = parseSketchJson(JSON.stringify(sketch));
  expect(loaded.route).toEqual(['P1']);
  expect(loaded.drive).toEqual(sketch.drive);
  expect(loaded.transmission!.belts[0]!.toothCounts.P1).toBe(sketch.pulleys[0]!.toothCount);
});
