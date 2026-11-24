import type { BeltProfile, Point, Sketch } from './model';

export type Axle = { id: string; x: number; y: number; componentIds: string[] };
export type BeltStage = { catalogSku?: string; id: string; profile: BeltProfile; route: string[]; toothCounts: Record<string, number>; pulleyProfiles?: Record<string, BeltProfile> };
export type Gear = {
  catalogSku?: string;
  id: string; name: string; axleId: string; plane: number;
  toothCount: number; moduleMm: number; pressureAngleDeg: number; boreMm: number;
};
export type GearMesh = { id: string; gearAId: string; gearBId: string; plane: number; angleDeg?: number };
export type Transmission = { axles: Axle[]; belts: BeltStage[]; gears: Gear[]; meshes: GearMesh[] };
export type LegacySketch = Pick<Sketch, 'pulleys' | 'idlers' | 'route' | 'profile'>;

export const DEFAULT_GOBILDA_GEAR: Omit<Gear, 'id' | 'name' | 'axleId' | 'plane'> = {
  toothCount: 24, moduleMm: 0.8, pressureAngleDeg: 20, boreMm: 8,
};

export function hasOtherPulleyOnBeltAxle(sketch: Sketch, pulleyId: string, beltId: string): boolean {
  const axle = sketch.transmission?.axles.find(item => item.componentIds.includes(pulleyId));
  const belt = sketch.transmission?.belts.find(item => item.id === beltId);
  return Boolean(axle && belt && axle.componentIds.some(memberId =>
    memberId !== pulleyId && sketch.pulleys.some(pulley => pulley.id === memberId && belt.route.includes(memberId))));
}

export function migrateLegacyTransmission(sketch: LegacySketch): Transmission {
  const components = [...sketch.pulleys, ...sketch.idlers];
  const axles = components.map(item => ({ id: `AX-${item.id}`, x: item.x, y: item.y, componentIds: [item.id] }));
  const belts = sketch.route.length ? [{ id: 'B1', profile: sketch.profile, route: [...sketch.route], toothCounts: Object.fromEntries(sketch.pulleys.map(p => [p.id, p.toothCount])), pulleyProfiles: Object.fromEntries(sketch.pulleys.filter(p => sketch.route.includes(p.id)).map(p => [p.id, sketch.profile])) }] : [];
  return { axles, belts, gears: [], meshes: [] };
}

export function sketchForBeltStage(sketch: Sketch, belt: BeltStage): Sketch {
  return {
    ...sketch,
    profile: belt.profile,
    route: [...belt.route],
    activeBeltId: belt.id,
    pulleys: sketch.pulleys.map(pulley => ({
      ...pulley,
      profile: belt.pulleyProfiles?.[pulley.id] ?? belt.profile,
    })),
  };
}

export function gearPitchDiameter(gear: Pick<Gear, 'toothCount' | 'moduleMm'>): number {
  if (!Number.isInteger(gear.toothCount) || gear.toothCount <= 0 || !Number.isFinite(gear.moduleMm) || gear.moduleMm <= 0) {
    throw new RangeError('Gear teeth and module must be positive.');
  }
  return gear.toothCount * gear.moduleMm;
}

export function gearMeshCenterDistance(first: Pick<Gear, 'toothCount' | 'moduleMm'>, second: Pick<Gear, 'toothCount' | 'moduleMm'>): number {
  if (first.moduleMm !== second.moduleMm) throw new RangeError('Meshing gears must use the same module.');
  return (gearPitchDiameter(first) + gearPitchDiameter(second)) / 2;
}

export function tangentGearPosition(host: Point, direction: Point, first: Gear, second: Gear): Point {
  const length = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('A non-zero placement direction is required.');
  const distance = gearMeshCenterDistance(first, second);
  return { x: host.x + direction.x / length * distance, y: host.y + direction.y / length * distance };
}

export type SpeedEdge = { fromId: string; toId: string; multiplier: number; kind: 'belt' | 'gear' };
export type SpeedGraphResult = { speeds: Record<string, number>; conflict: string | null };

export function transmissionSpeedEdges(transmission: Transmission): SpeedEdge[] {
  const edges: SpeedEdge[] = [];
  for (const belt of transmission.belts) {
    if (belt.route.length < 3 || belt.route[0] !== belt.route.at(-1)) continue;
    const pulleys = belt.route.slice(0, -1).map(id => ({ id, teeth: belt.toothCounts[id] })).filter(p => p.teeth > 0);
    for (let index = 0; index < pulleys.length - 1; index += 1) {
      const first = pulleys[index]!; const second = pulleys[index + 1]!;
      if (first.teeth && second.teeth) edges.push({ fromId: first.id, toId: second.id, multiplier: first.teeth / second.teeth, kind: 'belt' });
    }
  }
  for (const mesh of transmission.meshes) {
    const first = transmission.gears.find(g => g.id === mesh.gearAId);
    const second = transmission.gears.find(g => g.id === mesh.gearBId);
    if (!first || !second) continue;
    edges.push({ fromId: first.id, toId: second.id, multiplier: -first.toothCount / second.toothCount, kind: 'gear' });
  }
  for (const axle of transmission.axles) {
    const members = [...new Set([...axle.componentIds, ...transmission.gears.filter(g => g.axleId === axle.id).map(g => g.id)])];
    for (let index = 1; index < members.length; index += 1) edges.push({ fromId: members[0]!, toId: members[index]!, multiplier: 1, kind: 'belt' });
  }
  return edges;
}

export function calculateTransmissionSpeeds(transmission: Transmission, sourceId: string, sourceRpm: number): SpeedGraphResult {
  if (!Number.isFinite(sourceRpm)) return { speeds: {}, conflict: 'Input speed must be finite.' };
  const edges = transmissionSpeedEdges(transmission);
  const adjacency = new Map<string, Array<{ id: string; multiplier: number }>>();
  const connect = (a: string, b: string, ratio: number) => {
    adjacency.set(a, [...(adjacency.get(a) ?? []), { id: b, multiplier: ratio }]);
  };
  for (const edge of edges) { connect(edge.fromId, edge.toId, edge.multiplier); connect(edge.toId, edge.fromId, 1 / edge.multiplier); }
  const speeds: Record<string, number> = { [sourceId]: sourceRpm };
  let conflict: string | null = null;
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      const value = speeds[current]! * next.multiplier;
      if (next.id in speeds) {
        if (Math.abs(speeds[next.id]! - value) > 1e-8 * Math.max(1, Math.abs(value))) conflict = `Transmission loop gives conflicting speed at ${next.id}.`;
      } else { speeds[next.id] = value; queue.push(next.id); }
    }
  }
  return { speeds, conflict };
}
