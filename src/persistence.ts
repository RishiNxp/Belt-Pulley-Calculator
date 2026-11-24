import { createDemoSketch, createEmptySketch } from './demo';
import type { BeltProfile, Sketch } from './model';
import { migrateLegacyTransmission } from './transmission';

export const STORAGE_KEY = 'belt-pulley-calculator.sketch.v1';

type SketchStorage = Pick<Storage, 'getItem' | 'setItem'>;
const profiles = new Set<BeltProfile>(['GT2', 'GT2 3mm', 'GT3', 'HTD 5M']);

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
      || (!sketch.transmission && pulley.profile !== sketch.profile)
      || !isFiniteNumber(pulley.x) || !isFiniteNumber(pulley.y)
      || typeof pulley.isOrigin !== 'boolean') {
      throw new Error('A pulley has invalid profile, teeth, label, or position values.');
    }
    if (objectIds.has(pulley.id)) throw new Error(`Sketch object ${pulley.id} appears more than once.`);
    objectIds.add(pulley.id);
  }
  if (sketch.pulleys.some(p => p.isOrigin) || (sketch.pulleys.length > 0 && !sketch.transmission)) {
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
      || !isFiniteNumber(idler.x) || !isFiniteNumber(idler.y)
      || (idler.beltId !== undefined && idler.beltId !== null && typeof idler.beltId !== 'string')
      || (idler.locked !== undefined && typeof idler.locked !== 'boolean')
      || (idler.tensionSide !== undefined && idler.tensionSide !== 'inside' && idler.tensionSide !== 'outside')) {
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
  if (sketch.route.length > 1 && sketch.route[0] === sketch.route.at(-1) && sketch.route.length < 3) {
    throw new Error('A closed route needs at least two distinct objects.');
  }

  const dimensionKinds = new Set(['horizontal', 'vertical', 'aligned']);
  const endpoints = new Set(objectIds);
  if (Array.isArray(sketch.transmission?.gears)) for (const gear of sketch.transmission.gears) {
    if (typeof gear?.id === 'string') endpoints.add(gear.id);
  }
  const relationIds = new Set(endpoints);
  for (const dimension of sketch.dimensions) {
    if (!isObject(dimension)
      || typeof dimension.id !== 'string' || !dimension.id.trim()
      || !endpoints.has(dimension.fromId)
      || (dimension.toId !== undefined && !endpoints.has(dimension.toId))
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
      || !endpoints.has(constraint.firstId) || !endpoints.has(constraint.secondId)
      || !constraintKinds.has(constraint.kind)) {
      throw new Error('A sketch constraint has invalid references or values.');
    }
    if (relationIds.has(constraint.id)) throw new Error(`Sketch entity ID ${constraint.id} appears more than once.`);
    relationIds.add(constraint.id);
  }

  const settings: Record<string, unknown> = isObject(sketch.drive) ? sketch.drive : {};
  const pulleyIds = new Set(sketch.pulleys.map(pulley => pulley.id));
  const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
  if (![transmission.belts, transmission.axles, transmission.gears, transmission.meshes].every(Array.isArray)) throw new Error('Invalid transmission lists.');
  const driveId = (id: unknown) => typeof id === 'string' && (transmission.gears.some(g => g.id === id) || pulleyIds.has(id) && (transmission.belts.some(belt => belt.route.includes(id)) || transmission.axles.some(a => a.componentIds.includes(id) && a.componentIds.length > 1))) ? id : null;
  const beltIds = new Set<string>();
  for (const belt of transmission.belts) {
    if (!isObject(belt) || typeof belt.id !== 'string' || !belt.id || beltIds.has(belt.id)
      || !profiles.has(belt.profile) || !Array.isArray(belt.route) || !isObject(belt.toothCounts)) throw new Error('Transmission belt stage is invalid.');
    beltIds.add(belt.id);
    if (belt.route.some(id => typeof id !== 'string' || !objectIds.has(id))) throw new Error(`Belt ${belt.id} refers to a missing component.`);
    if (Object.values(belt.toothCounts).some(teeth => !Number.isInteger(teeth) || (teeth as number) <= 0)) throw new Error(`Belt ${belt.id} has invalid tooth counts.`);
    if (belt.pulleyProfiles !== undefined && (!isObject(belt.pulleyProfiles) || Object.entries(belt.pulleyProfiles).some(([id, profile]) => !belt.route.includes(id) || !profiles.has(profile as BeltProfile)))) throw new Error(`Belt ${belt.id} has invalid pulley profiles.`);
  }
  const currentTeeth = Object.fromEntries(sketch.pulleys.map(p => [p.id, p.toothCount]));
  transmission.belts = transmission.belts.map(belt => ({ ...belt, toothCounts: currentTeeth }));
  const gearIds = new Set<string>();
  for (const gear of transmission.gears) {
    if (!isObject(gear) || typeof gear.id !== 'string' || !gear.id.trim() || objectIds.has(gear.id) || gearIds.has(gear.id)
      || typeof gear.name !== 'string' || !Number.isInteger(gear.toothCount) || gear.toothCount <= 0
      || !isFiniteNumber(gear.moduleMm) || gear.moduleMm <= 0 || !isFiniteNumber(gear.pressureAngleDeg)
      || !isFiniteNumber(gear.boreMm) || gear.boreMm <= 0 || !Number.isInteger(gear.plane)
      || typeof gear.axleId !== 'string') throw new Error('Transmission gear is invalid.');
    gearIds.add(gear.id);
  }
  const axleIds = new Set<string>();
  for (const axle of transmission.axles) {
    if (!isObject(axle) || typeof axle.id !== 'string' || !axle.id || axleIds.has(axle.id)
      || !isFiniteNumber(axle.x) || !isFiniteNumber(axle.y) || !Array.isArray(axle.componentIds)
      || axle.componentIds.some(id => typeof id !== 'string' || (!objectIds.has(id) && !gearIds.has(id)))) throw new Error('Transmission axle is invalid.');
    axleIds.add(axle.id);
  }
  for (const gear of transmission.gears) if (!axleIds.has(gear.axleId)) throw new Error(`Gear ${gear.id} refers to a missing axle.`);
  const meshIds = new Set<string>();
  for (const mesh of transmission.meshes) {
    const first = transmission.gears.find(gear => gear.id === mesh.gearAId);
    const second = transmission.gears.find(gear => gear.id === mesh.gearBId);
    if (!isObject(mesh) || typeof mesh.id !== 'string' || !mesh.id || meshIds.has(mesh.id) || !first || !second
      || first.id === second.id || first.axleId === second.axleId || first.plane !== second.plane
      || first.moduleMm !== second.moduleMm || mesh.plane !== first.plane
      || (mesh.angleDeg !== undefined && !isFiniteNumber(mesh.angleDeg))) throw new Error('Transmission gear mesh is invalid.');
    meshIds.add(mesh.id);
  }
  const activeBeltId = sketch.activeBeltId === null
    ? null
    : typeof sketch.activeBeltId === 'string' && beltIds.has(sketch.activeBeltId) ? sketch.activeBeltId : transmission.belts[0]?.id;
  const activeBelt = transmission.belts.find(b => b.id === activeBeltId);
  const idlers = sketch.idlers.map(idler => {
    const belt = transmission.belts.find(item => item.id === idler.beltId || item.route.includes(idler.id))
      ?? (sketch.route.includes(idler.id) ? activeBelt : undefined);
    const beltId = idler.beltId !== undefined ? idler.beltId : belt?.id ?? null;
    return { ...idler, beltId, locked: idler.locked ?? beltId !== null, tensionSide: idler.tensionSide ?? 'outside' };
  });
  return { ...sketch, idlers, transmission, activeBeltId, ...(activeBelt ? { route: [...activeBelt.route], profile: activeBelt.profile } : activeBeltId === null ? { route: [] } : {}), drive: {
    ...Object.fromEntries(['torque','efficiency','diameter','motor'].filter(key => typeof settings[key] === 'string').map(key => [key, settings[key]])),
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
    return saved ? parseSketchJson(saved) : createEmptySketch();
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
