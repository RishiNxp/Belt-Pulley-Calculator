import { createDemoSketch } from './demo';
import type { BeltProfile, Sketch } from './model';

export const STORAGE_KEY = 'belt-pulley-calculator.sketch.v1';

type SketchStorage = Pick<Storage, 'getItem' | 'setItem'>;
const profiles = new Set<BeltProfile>(['GT2', 'GT3', 'HTD 5M']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function requireDesign(value: unknown): Sketch {
  if (!isObject(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported or invalid sketch schema version.');
  }
  const sketch = value as unknown as Sketch;
  if (!profiles.has(sketch.profile)) throw new Error('Sketch has an unsupported belt profile.');
  if (!Array.isArray(sketch.pulleys) || !Array.isArray(sketch.idlers) || !Array.isArray(sketch.route)) {
    throw new Error('Sketch components and route must be lists.');
  }
  if (!Array.isArray(sketch.dimensions) || !Array.isArray(sketch.constraints)) {
    throw new Error('Sketch dimensions and constraints must be lists.');
  }
  if (!isFiniteNumber(sketch.toleranceTeeth) || sketch.toleranceTeeth < 0) {
    throw new Error('Sketch tooth tolerance is invalid.');
  }
  if (!Array.isArray(sketch.availableBeltTeeth)
    || sketch.availableBeltTeeth.some((teeth) => !Number.isInteger(teeth) || teeth <= 0)) {
    throw new Error('Available belt sizes must be positive whole tooth counts.');
  }
  if (!isObject(sketch.view)
    || !isFiniteNumber(sketch.view.centerX)
    || !isFiniteNumber(sketch.view.centerY)
    || !isFiniteNumber(sketch.view.zoom)
    || sketch.view.zoom <= 0) {
    throw new Error('Sketch viewport is invalid.');
  }

  const objectIds = new Set<string>();
  for (const pulley of sketch.pulleys) {
    if (!isObject(pulley)
      || typeof pulley.id !== 'string' || !pulley.id.trim()
      || typeof pulley.label !== 'string'
      || !Number.isInteger(pulley.toothCount) || pulley.toothCount <= 0
      || !profiles.has(pulley.profile)
      || pulley.profile !== sketch.profile
      || !isFiniteNumber(pulley.x) || !isFiniteNumber(pulley.y)
      || typeof pulley.isOrigin !== 'boolean') {
      throw new Error('A pulley has invalid profile, teeth, label, or position values.');
    }
    if (objectIds.has(pulley.id)) throw new Error(`Sketch object ${pulley.id} appears more than once.`);
    objectIds.add(pulley.id);
  }
  if (sketch.pulleys.length > 0) {
    const origins = sketch.pulleys.filter((pulley) => pulley.isOrigin);
    if (origins.length !== 1 || sketch.pulleys[0] !== origins[0] || origins[0]!.x !== 0 || origins[0]!.y !== 0) {
      throw new Error('The first pulley must be the sketch origin at X 0 and Y 0.');
    }
  }

  for (const idler of sketch.idlers) {
    if (!isObject(idler)
      || typeof idler.id !== 'string' || !idler.id.trim()
      || typeof idler.label !== 'string'
      || !isFiniteNumber(idler.diameterMm) || idler.diameterMm <= 0
      || !isFiniteNumber(idler.x) || !isFiniteNumber(idler.y)) {
      throw new Error('A tensioner has an invalid label, diameter, or position.');
    }
    if (objectIds.has(idler.id)) throw new Error(`Sketch object ${idler.id} appears more than once.`);
    objectIds.add(idler.id);
  }

  if (sketch.route.some((id) => typeof id !== 'string' || !objectIds.has(id))) {
    throw new Error('Belt route refers to a missing sketch object.');
  }
  const routeWithoutClose = sketch.route.length > 1 && sketch.route[0] === sketch.route.at(-1)
    ? sketch.route.slice(0, -1)
    : sketch.route;
  if (new Set(routeWithoutClose).size !== routeWithoutClose.length) {
    throw new Error('Belt route visits a component more than once.');
  }
  if (sketch.route.length > 0 && sketch.route[0] === sketch.route.at(-1) && sketch.route.length < 3) {
    throw new Error('A closed route needs at least two distinct objects.');
  }

  const dimensionKinds = new Set(['horizontal', 'vertical', 'aligned']);
  const relationIds = new Set(objectIds);
  for (const dimension of sketch.dimensions) {
    if (!isObject(dimension)
      || typeof dimension.id !== 'string' || !dimension.id.trim()
      || !objectIds.has(dimension.fromId)
      || (dimension.toId !== undefined && !objectIds.has(dimension.toId))
      || !dimensionKinds.has(dimension.kind)
      || !isFiniteNumber(dimension.valueMm)
      || !isFiniteNumber(dimension.offsetMm)) {
      throw new Error('A sketch dimension has invalid references or values.');
    }
    if (relationIds.has(dimension.id)) throw new Error(`Sketch entity ID ${dimension.id} appears more than once.`);
    relationIds.add(dimension.id);
  }
  const constraintKinds = new Set(['horizontal', 'vertical']);
  for (const constraint of sketch.constraints) {
    if (!isObject(constraint)
      || typeof constraint.id !== 'string' || !constraint.id.trim()
      || !objectIds.has(constraint.firstId) || !objectIds.has(constraint.secondId)
      || !constraintKinds.has(constraint.kind)) {
      throw new Error('A sketch constraint has invalid references or values.');
    }
    if (relationIds.has(constraint.id)) throw new Error(`Sketch entity ID ${constraint.id} appears more than once.`);
    relationIds.add(constraint.id);
  }

  const settings: Record<string, unknown> = isObject(sketch.drive) ? sketch.drive : {};
  const pulleyIds = new Set(sketch.pulleys.map(pulley => pulley.id));
  const driveId = (id: unknown) => typeof id === 'string' && pulleyIds.has(id) && sketch.route.includes(id) ? id : null;
  return { ...sketch, drive: {
    driverId: driveId(settings.driverId),
    outputId: driveId(settings.outputId),
    driverRpm: isFiniteNumber(settings.driverRpm) && settings.driverRpm >= 0 ? settings.driverRpm : null,
  } };
}

export function parseSketchJson(source: string): Sketch {
  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isObject(decoded)) throw new Error('This file does not contain a sketch design.');

  if ('version' in decoded) {
    if (decoded.version !== 1) throw new Error(`Unsupported design file version: ${String(decoded.version)}.`);
    return requireDesign(decoded.sketch);
  }
  return requireDesign(decoded);
}

export function loadSketch(storage: SketchStorage): Sketch {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    return saved ? parseSketchJson(saved) : createDemoSketch();
  } catch {
    return createDemoSketch();
  }
}

export function saveSketch(storage: SketchStorage, sketch: Sketch): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sketch }));
  } catch {
    // The sketch remains usable when local persistence is unavailable or full.
  }
}
