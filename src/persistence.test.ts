import { describe, expect, it } from 'vitest';
import { createDemoSketch } from './demo';
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
    expect(loadSketch(storage)).toEqual(sketch);
    expect(parseSketchJson(JSON.stringify({ version: 1, sketch }))).toEqual(sketch);
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
});
