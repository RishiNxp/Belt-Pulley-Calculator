import { createEmptySketch } from './demo';
import { solveSketchRelations } from './relations';
import type {
  BeltProfile,
  HistoryState,
  Idler,
  Point,
  Pulley,
  Sketch,
  SketchConstraint,
  SketchDimension,
} from './model';
import { calculateBeltGeometry } from './geometry';
import { sketchForBeltStage, calculateTransmissionSpeeds, gearMeshCenterDistance, hasOtherPulleyOnBeltAxle, migrateLegacyTransmission, tangentGearPosition } from './transmission';
import type { Gear } from './transmission';

export type SketchAction =
  | { type: "SET_GEAR_BORE"; id: string; value: number }
  | { type: "SET_CATALOG_SKU"; id: string; sku: string }
  | { type: 'ADD_PULLEY'; pulley: Pulley; segment?: { fromId: string; toId: string } }
  | { type: 'ADD_COAXIAL_PULLEY'; pulley: Pulley; hostId: string }
  | { type: 'ADD_GEAR'; gear: Gear; x: number; y: number; hostId?: string }
  | { type: 'MESH_GEARS'; firstId: string; secondId: string; id: string; plane: number }
  | { type: 'ADD_MESHED_GEAR'; hostId: string; gear: Gear; meshId: string; angleDeg: number }
  | { type: 'SET_GEAR_MODULE'; id: string; moduleMm: number }
  | { type: 'UPDATE_GEAR'; id: string; toothCount: number }
  | { type: 'ADD_IDLER'; idler: Idler; segment?: { fromId: string; toId: string }; beltId?: string }
  | { type: 'LATCH_IDLER'; id: string; beltId: string; fromId: string; toId: string; point: Point; tensionSide?: Idler['tensionSide'] }
  | { type: 'UNLATCH_IDLER'; id: string }
  | { type: 'UPDATE_PULLEY'; id: string; changes: Partial<Pick<Pulley, 'label' | 'toothCount' | 'profile'>> }
  | { type: 'UPDATE_IDLER'; id: string; changes: Partial<Pick<Idler, 'label' | 'diameterMm' | 'tensionSide'>> }
  | { type: 'SET_LABEL'; id: string; label: string }
  | {type:'LATCH_PULLEY'; id:string; beltId:string; fromId:string; toId:string}
  | { type: 'FIT_BELT'; id:string; x:number; y:number; beltId:string; sku:string }
  | { type: 'MOVE_OBJECT'; id: string; x: number; y: number }
  | { type: 'BEGIN_DRAG'; id: string }
  | { type: 'REORDER_AXLE'; id: string; target: string }
  | { type: 'UNLOCK_GEAR'; id: string }
  | { type: 'END_DRAG' }
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'ADD_DIMENSION'; dimension: SketchDimension }
  | { type: 'SET_DIMENSION_VALUE'; id: string; valueMm: number }
  | { type: 'REMOVE_DIMENSION'; id: string }
  | { type: 'ADD_CONSTRAINT'; constraint: SketchConstraint }
  | { type: 'REMOVE_CONSTRAINT'; id: string }
  | { type: 'ROUTE_CLICK'; objectId: string }
  | { type: 'ADD_BELT_STAGE'; id: string; profile?: BeltProfile }
  | { type: 'SET_ACTIVE_BELT'; id: string | null }
  | { type: 'SET_PULLEY_BELT'; id: string; beltId: string | null }
  | { type: 'CLEAR_ROUTE' }
  | { type: 'SET_DRIVE'; changes: Partial<NonNullable<Sketch['drive']>> }
  | { type: 'SET_PROFILE'; profile: BeltProfile }
  | { type: 'SET_BELT_PROFILE'; profile: BeltProfile }
  | { type: 'SET_TOLERANCE'; value: number }
  | { type: 'SET_AVAILABLE_BELTS'; values: number[] }
  | { type: 'SET_VIEW'; view: Sketch['view'] }
  | { type: 'NEW_SKETCH' }
  | { type: 'LOAD_SKETCH'; sketch: Sketch }
  | { type: 'UNDO' }
  | { type: 'REDO' };

type LocatedObject = { id: string; x: number; y: number; isOrigin: boolean };

export function insertRouteMember(route: string[], fromId: string, toId: string, id: string): string[] | null {
  const edge = route.findIndex((from, index) => from === fromId && route[index + 1] === toId);
  if (edge < 0 || route.includes(id)) return null;
  return [...route.slice(0, edge + 1), id, ...route.slice(edge + 1)];
}

function removeIdlerFromRoute(sketch: Pick<Sketch, 'pulleys'>, route: string[], id: string): string[] {
  const closed = route.length >= 3 && route[0] === route.at(-1);
  const members = (closed ? route.slice(0, -1) : route).filter(member => member !== id);
  if (!closed) return members;
  const toothedCount = members.filter(member => sketch.pulleys.some(pulley => pulley.id === member)).length;
  return toothedCount >= 2 && members.length >= 2 ? [...members, members[0]!] : [];
}

function findObject(sketch: Sketch, id: string): LocatedObject | undefined {
  const pulley = sketch.pulleys.find((item) => item.id === id);
  if (pulley) return pulley;
  const idler = sketch.idlers.find((item) => item.id === id);
  if (idler) return { ...idler, isOrigin: false };
  const gear = sketch.transmission?.gears.find(item => item.id === id);
  const axle = gear && sketch.transmission?.axles.find(item => item.id === gear.axleId);
  return axle ? { id, x: axle.x, y: axle.y, isOrigin: false } : undefined;
}

function replacePosition(sketch: Sketch, id: string, point: Point): Sketch {
  const gearAxleId = sketch.transmission?.gears.find(gear => gear.id === id)?.axleId;
  const axle = sketch.transmission?.axles.find(item => item.componentIds.includes(id) || item.id === gearAxleId);
  const members = new Set(axle?.componentIds ?? [id]);
  const pulley = sketch.pulleys.find((item) => item.id === id);
  if (pulley) {
    if (pulley.isOrigin || (pulley.x === point.x && pulley.y === point.y)) return sketch;
    return {
      ...sketch,
      pulleys: sketch.pulleys.map((item) => members.has(item.id) ? { ...item, ...point } : item),
      idlers: sketch.idlers.map(item => members.has(item.id) ? { ...item, ...point } : item),
      ...(axle ? { transmission: { ...sketch.transmission!, axles: sketch.transmission!.axles.map(item => item.id === axle.id ? { ...item, ...point } : item) } } : {}),
    };
  }

  const idler = sketch.idlers.find((item) => item.id === id);
  if (idler) {
    if (idler.x === point.x && idler.y === point.y) return sketch;
  } else if (!gearAxleId) return sketch;
  return {
    ...sketch,
    pulleys: sketch.pulleys.map(item => members.has(item.id) ? { ...item, ...point } : item),
    idlers: sketch.idlers.map((item) => members.has(item.id) ? { ...item, ...point } : item),
    ...(axle ? { transmission: { ...sketch.transmission!, axles: sketch.transmission!.axles.map(item => item.id === axle.id ? { ...item, ...point } : item) } } : {}),
  };
}

function sameSketch(first: Sketch, second: Sketch): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function repositionMates(transmission: NonNullable<Sketch['transmission']>): Sketch['transmission'] {
  let axles = [...transmission.axles];
  for (let pass = 0; pass < transmission.meshes.length; pass += 1) {
    for (const mesh of transmission.meshes) {
      const first = transmission.gears.find(gear => gear.id === mesh.gearAId);
      const second = transmission.gears.find(gear => gear.id === mesh.gearBId);
      const firstAxle = axles.find(axle => axle.id === first?.axleId);
      if (!first || !second || !firstAxle) continue;
      const angle = (mesh.angleDeg ?? 0) * Math.PI / 180;
      const position = tangentGearPosition(firstAxle, { x: Math.cos(angle), y: Math.sin(angle) }, first, second);
      axles = axles.map(axle => axle.id === second.axleId ? { ...axle, ...position } : axle);
    }
  }
  return { ...transmission, axles };
}

function meshesRemainTangent(sketch: Sketch): boolean {
  const transmission = sketch.transmission;
  if (!transmission) return true;
  return transmission.meshes.every(mesh => {
    const first = transmission.gears.find(gear => gear.id === mesh.gearAId);
    const second = transmission.gears.find(gear => gear.id === mesh.gearBId);
    const firstAxle = transmission.axles.find(axle => axle.id === first?.axleId);
    const secondAxle = transmission.axles.find(axle => axle.id === second?.axleId);
    if (!first || !second || !firstAxle || !secondAxle) return false;
    return Math.abs(Math.hypot(secondAxle.x - firstAxle.x, secondAxle.y - firstAxle.y) - gearMeshCenterDistance(first, second)) < 1e-6;
  });
}

export function snapDraggedGear(sketch: Sketch, id: string): Sketch {
  const tr = sketch.transmission;
  const gear = tr?.gears.find(item => item.id === id);
  const axle = tr?.axles.find(item => item.id === gear?.axleId);
  if (!tr || !gear || !axle) return sketch;
  let nearest = 12 / sketch.view.zoom;
  let result = sketch;
  for (const mate of tr.gears) {
    if (mate.axleId === axle.id || mate.moduleMm !== gear.moduleMm || mate.plane !== gear.plane || mate.pressureAngleDeg !== gear.pressureAngleDeg) continue;
    if (tr.meshes.some(m => [m.gearAId, m.gearBId].includes(id) && [m.gearAId, m.gearBId].includes(mate.id))) continue;
    const center = tr.axles.find(item => item.id === mate.axleId);
    if (!center) continue;
    const direction = { x: axle.x - center.x, y: axle.y - center.y };
    const distance = Math.hypot(direction.x, direction.y);
    const gap = Math.abs(distance - gearMeshCenterDistance(mate, gear));
    if (distance === 0 || gap > nearest) continue;
    const point = tangentGearPosition(center, direction, mate, gear);
    const moved = solveSketchRelations(replacePosition(sketch, id, point), id);
    if (!moved?.transmission) continue;
    const mesh = { id: 'mesh-' + mate.id + '-' + id, gearAId: mate.id, gearBId: id, plane: gear.plane, angleDeg: Math.atan2(direction.y, direction.x) * 180 / Math.PI };
    const candidate = { ...moved, transmission: { ...moved.transmission, meshes: [...tr.meshes, mesh] } };
    if (meshesRemainTangent(candidate)) { nearest = gap; result = candidate; }
  }
  return result;
}

function finishActiveEdit(state: HistoryState): HistoryState {
  if (!state.activeEdit) return state;
  const past = sameSketch(state.present, state.activeEdit.before)
    ? state.past
    : [...state.past.slice(-99), state.activeEdit.before];
  return { ...state, past, future: [], activeEdit: null };
}

function recordChange(state: HistoryState, present: Sketch): HistoryState {
  if (present === state.present) return state;
  return {
    past: [...state.past.slice(-99), state.present],
    present,
    future: [],
    activeEdit: null,
  };
}

function syncActiveBelt(sketch: Sketch): Sketch {
  const base = sketch.transmission ?? migrateLegacyTransmission(sketch);
  const counts = Object.fromEntries(sketch.pulleys.map(p => [p.id, p.toothCount]));
  const transmission = { ...base, belts: base.belts.map(belt => ({ ...belt, toothCounts: counts })) };
  if (sketch.activeBeltId === null) return { ...sketch, transmission };
  const active = transmission.belts.find(belt => belt.id === sketch.activeBeltId) ?? transmission.belts[0];
  const belts = [...transmission.belts];
  if (active) {
    const index = belts.findIndex(belt => belt.id === active.id);
    const counts = Object.fromEntries(sketch.pulleys.map(p => [p.id, p.toothCount]));
    const pulleyProfiles = Object.fromEntries(sketch.pulleys.filter(p => sketch.route.includes(p.id)).map(p => [p.id, sketch.profile]));
    belts[index] = { ...active, route: [...sketch.route], profile: sketch.profile, toothCounts: counts, pulleyProfiles };
    return { ...sketch, transmission: { ...transmission, belts }, activeBeltId: active.id };
  }
  return { ...sketch, transmission };
}

function reducePresent(sketch: Sketch, action: Exclude<SketchAction, { type: 'UNDO' | 'REDO' }>): Sketch | null {
  switch (action.type) {
    case 'SET_LABEL':
      if (sketch.transmission?.gears.some(g => g.id === action.id)) return { ...sketch, transmission: { ...sketch.transmission, gears: sketch.transmission.gears.map(g => g.id === action.id ? { ...g, name: action.label } : g) } };
      return { ...sketch, pulleys: sketch.pulleys.map(p => p.id === action.id ? { ...p, label: action.label } : p), idlers: sketch.idlers.map(p => p.id === action.id ? { ...p, label: action.label } : p) };
    case 'ADD_PULLEY': {
      if (findObject(sketch, action.pulley.id)) return sketch;
      if (!Number.isInteger(action.pulley.toothCount) || action.pulley.toothCount <= 0
        || !Number.isFinite(action.pulley.x) || !Number.isFinite(action.pulley.y)) return sketch;
      let route = sketch.route;
      if (action.segment) {
        const inserted = insertRouteMember(route, action.segment.fromId, action.segment.toId, action.pulley.id);
        if (!inserted) return sketch;
        route = inserted;
      }
      const isFirst = sketch.pulleys.length === 0;
      const profile = isFirst ? action.pulley.profile : sketch.profile;
      const pulley: Pulley = {
        ...action.pulley,
        profile,
        x: isFirst ? 0 : action.pulley.x,
        y: isFirst ? 0 : action.pulley.y,
        isOrigin: isFirst,
      };
      return {
        ...sketch,
        profile,
        pulleys: [...sketch.pulleys, pulley],
        route,
      };
    }
    case 'ADD_COAXIAL_PULLEY': {
      const host = findObject(sketch, action.hostId);
      if (!host || findObject(sketch, action.pulley.id) || !Number.isInteger(action.pulley.toothCount) || action.pulley.toothCount <= 0) return sketch;
      const pulley = { ...action.pulley, x: host.x, y: host.y, isOrigin: false };
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      const axleId = transmission.axles.find(axle => axle.componentIds.includes(host.id))?.id ?? `AX-${host.id}`;
      const axles = transmission.axles.some(axle => axle.id === axleId)
        ? transmission.axles.map(axle => axle.id === axleId ? { ...axle, componentIds: [...axle.componentIds, pulley.id] } : axle)
        : [...transmission.axles, { id: axleId, x: host.x, y: host.y, componentIds: [host.id, pulley.id] }];
      return { ...sketch, pulleys: [...sketch.pulleys, pulley], transmission: { ...transmission, axles } };
    }
    case 'ADD_GEAR': {
      if (!Number.isInteger(action.gear.toothCount) || action.gear.toothCount <= 0 || action.gear.moduleMm <= 0) return sketch;
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      let axleId = action.gear.axleId;
      let axles = transmission.axles;
      if (action.hostId) {
        const hostAxle = axles.find(axle => axle.componentIds.includes(action.hostId!));
        axleId = hostAxle?.id ?? `AX-${action.hostId}`;
        axles = hostAxle ? axles.map(axle => axle.id === axleId ? { ...axle, componentIds: [...axle.componentIds, action.gear.id] } : axle)
          : [...axles, { id: axleId, x: action.x, y: action.y, componentIds: [action.hostId, action.gear.id] }];
      } else axles = [...axles, { id: axleId, x: action.x, y: action.y, componentIds: [action.gear.id] }];
      return { ...sketch, transmission: { ...transmission, axles, gears: [...transmission.gears, { ...action.gear, axleId }] } };
    }
    case 'MESH_GEARS': {
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      const first = transmission.gears.find(gear => gear.id === action.firstId);
      const second = transmission.gears.find(gear => gear.id === action.secondId);
      if (!first || !second || first.id === second.id || first.axleId === second.axleId || first.plane !== second.plane || first.moduleMm !== second.moduleMm) return sketch;
      if (transmission.meshes.some(mesh => [mesh.gearAId, mesh.gearBId].includes(first.id) && [mesh.gearAId, mesh.gearBId].includes(second.id))) return sketch;
      return { ...sketch, transmission: { ...transmission, meshes: [...transmission.meshes, { id: action.id, gearAId: first.id, gearBId: second.id, plane: action.plane }] } };
    }
    case 'REORDER_AXLE': {
      const tr = sketch.transmission;
      const axle = tr?.axles.find(a => a.componentIds.includes(action.id) && a.componentIds.includes(action.target));
      if (!tr || !axle || action.id === action.target) return sketch;
      const members = axle.componentIds.filter(id => id !== action.id);
      members.splice(axle.componentIds.indexOf(action.target), 0, action.id);
      return { ...sketch, transmission: { ...tr, axles: tr.axles.map(a => a === axle ? { ...a, componentIds: members } : a) } };
    }
    case 'UNLOCK_GEAR': {
      const tr = sketch.transmission;
      if (!tr) return sketch;
      return { ...sketch, transmission: { ...tr, meshes: tr.meshes.filter(m => m.gearAId !== action.id && m.gearBId !== action.id) } };
    }
    case 'SET_GEAR_MODULE': {
      const tr = sketch.transmission;
      const gear = tr?.gears.find(item => item.id === action.id);
      if (!tr || !gear || !Number.isFinite(action.moduleMm) || action.moduleMm <= 0 || gear.moduleMm === action.moduleMm) return sketch;
      return { ...sketch, transmission: { ...tr,
        gears: tr.gears.map(item => item.id === gear.id ? { ...gear, moduleMm: action.moduleMm } : item),
        meshes: tr.meshes.filter(mesh => mesh.gearAId !== gear.id && mesh.gearBId !== gear.id),
      } };
    }
    case 'SET_GEAR_BORE': {
      const tr = sketch.transmission;
      if (!tr || !Number.isFinite(action.value) || action.value <= 0) return sketch;
      return { ...sketch, transmission: { ...tr, gears: tr.gears.map(g => g.id === action.id ? { ...g, boreMm: action.value } : g) } };
    }
    case 'SET_CATALOG_SKU': {
      const assign = <T extends {id: string}>(item: T) => item.id === action.id ? { ...item, catalogSku: action.sku } : item;
      const tr = sketch.transmission;
      return { ...sketch, pulleys: sketch.pulleys.map(assign), transmission: tr && { ...tr, gears: tr.gears.map(assign), belts: tr.belts.map(assign) } };
    }
    case 'UPDATE_GEAR': {
      if (!Number.isInteger(action.toothCount) || action.toothCount <= 0) return sketch;
      const transmission = sketch.transmission;
      if (!transmission?.gears.some(gear => gear.id === action.id)) return sketch;
      const gears = transmission.gears.map(gear => gear.id === action.id ? { ...gear, toothCount: action.toothCount } : gear);
      return { ...sketch, transmission: repositionMates({ ...transmission, gears }) };
    }
    case 'ADD_MESHED_GEAR': {
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      const host = transmission.gears.find(item => item.id === action.hostId);
      const hostAxle = host && transmission.axles.find(item => item.id === host.axleId);
      if (!host || !hostAxle || action.gear.moduleMm !== host.moduleMm) return sketch;
      const radians = action.angleDeg * Math.PI / 180;
      const point = tangentGearPosition(hostAxle, { x: Math.cos(radians), y: Math.sin(radians) }, host, action.gear);
      const axleId = action.gear.axleId;
      const gear = { ...action.gear, plane: host.plane };
      return {
        ...sketch,
        transmission: {
          ...transmission,
          axles: [...transmission.axles, { id: axleId, ...point, componentIds: [gear.id] }],
          gears: [...transmission.gears, gear],
          meshes: [...transmission.meshes, { id: action.meshId, gearAId: host.id, gearBId: gear.id, plane: gear.plane, angleDeg: action.angleDeg }],
        },
      };
    }
    case 'ADD_IDLER': {
      if (findObject(sketch, action.idler.id)) return sketch;
      if (!Number.isFinite(action.idler.diameterMm) || action.idler.diameterMm <= 0
        || !Number.isFinite(action.idler.x) || !Number.isFinite(action.idler.y)) return sketch;
      let route = sketch.route;
      let transmission = sketch.transmission;
      let beltId: string | null = null;
      if (action.segment) {
        beltId = action.beltId ?? sketch.activeBeltId ?? transmission?.belts[0]?.id ?? null;
        const belt = transmission?.belts.find(item => item.id === beltId);
        const sourceRoute = belt?.route ?? route;
        const inserted = insertRouteMember(sourceRoute, action.segment.fromId, action.segment.toId, action.idler.id);
        if (!inserted) return sketch;
        if (belt && transmission) {
          transmission = { ...transmission, belts: transmission.belts.map(item => item.id === belt.id ? { ...item, route: inserted } : item) };
          if (belt.id === sketch.activeBeltId) route = inserted;
        } else route = inserted;
      }
      const idler: Idler = {
        ...action.idler,
        beltId: action.segment ? beltId : null,
        locked: Boolean(action.segment),
        tensionSide: action.idler.tensionSide ?? 'outside',
      };
      return { ...sketch, idlers: [...sketch.idlers, idler], route, ...(transmission ? { transmission } : {}) };
    }
    case 'LATCH_PULLEY': {
      const tr = sketch.transmission;
      const belt = tr?.belts.find(b=>b.id===action.beltId);
      const pulley = sketch.pulleys.find(p=>p.id===action.id);
      if (!tr || !belt || !pulley || belt.profile!==pulley.profile || tr.belts.some(b=>b.route.includes(action.id)) || hasOtherPulleyOnBeltAxle(sketch,action.id,belt.id)) return sketch;
      const route = insertRouteMember(belt.route,action.fromId,action.toId,action.id);
      if (!route || !calculateBeltGeometry(sketchForBeltStage(sketch,{...belt,route})).valid) return sketch;
      return {...sketch,route:sketch.activeBeltId===belt.id?route:sketch.route,transmission:{...tr,belts:tr.belts.map(b=>b===belt?{...b,route}:b)}};
    }
    case 'LATCH_IDLER': {
      const idler = sketch.idlers.find(item => item.id === action.id);
      if (!idler || !Number.isFinite(action.point.x) || !Number.isFinite(action.point.y)) return sketch;
      const transmission = sketch.transmission;
      const belt = transmission?.belts.find(item => item.id === action.beltId);
      if (!transmission || !belt) return sketch;
      const currentRoute = removeIdlerFromRoute(sketch, belt.route, idler.id);
      const route = insertRouteMember(currentRoute, action.fromId, action.toId, idler.id);
      if (!route) return sketch;
      const updatedBelt = { ...belt, route };
      return {
        ...sketch,
        idlers: sketch.idlers.map(item => item.id === idler.id
          ? { ...item, x: action.point.x, y: action.point.y, beltId: belt.id, locked: true, tensionSide: action.tensionSide ?? item.tensionSide ?? 'outside' }
          : item),
        transmission: { ...transmission, belts: transmission.belts.map(item => item.id === belt.id ? updatedBelt : item) },
        ...(sketch.activeBeltId === belt.id ? { route: [...route], profile: belt.profile } : {}),
      };
    }
    case 'UNLATCH_IDLER': {
      const idler = sketch.idlers.find(item => item.id === action.id);
      if (!idler) return sketch;
      const transmission = sketch.transmission;
      const belt = transmission?.belts.find(item => item.id === idler.beltId || item.route.includes(idler.id));
      if (!belt || !transmission) {
        return {
          ...sketch,
          route: removeIdlerFromRoute(sketch, sketch.route, idler.id),
          idlers: sketch.idlers.map(item => item.id === idler.id ? { ...item, beltId: null, locked: false } : item),
        };
      }
      const route = removeIdlerFromRoute(sketch, belt.route, idler.id);
      return {
        ...sketch,
        idlers: sketch.idlers.map(item => item.id === idler.id ? { ...item, beltId: null, locked: false } : item),
        transmission: { ...transmission, belts: transmission.belts.map(item => item.id === belt.id ? { ...item, route } : item) },
        ...(sketch.activeBeltId === belt.id ? { route: [...route] } : {}),
      };
    }
    case 'UPDATE_PULLEY': {
      if (!sketch.pulleys.some((item) => item.id === action.id)) return sketch;
      if (action.changes.toothCount !== undefined && (!Number.isInteger(action.changes.toothCount) || action.changes.toothCount <= 0)) return sketch;
      return {
        ...sketch,
        pulleys: sketch.pulleys.map((item) => item.id === action.id ? { ...item, ...action.changes } : item),
      };
    }
    case 'UPDATE_IDLER':
      if (action.changes.diameterMm !== undefined && (!Number.isFinite(action.changes.diameterMm) || action.changes.diameterMm <= 0)) return sketch;
      if (action.changes.tensionSide !== undefined && action.changes.tensionSide !== 'inside' && action.changes.tensionSide !== 'outside') return sketch;
      return {
        ...sketch,
        idlers: sketch.idlers.map((item) => item.id === action.id ? { ...item, ...action.changes } : item),
      };
    case 'FIT_BELT': {
      if (sketch.activeBeltId !== action.beltId) return sketch;
      const moved=reducePresent(sketch,{...action,type:'MOVE_OBJECT'});
      return moved && reducePresent(moved,{type:'SET_CATALOG_SKU',id:action.beltId,sku:action.sku});
    }
    case 'MOVE_OBJECT': {
      const current = findObject(sketch, action.id);
      if (!current || current.isOrigin || !Number.isFinite(action.x) || !Number.isFinite(action.y)) return sketch;
      const tr = sketch.transmission;
      const gear = tr?.gears.find(item => item.id === action.id);
      const mesh = gear && tr?.meshes.find(item => item.gearAId === gear.id || item.gearBId === gear.id);
      const mate = mesh && tr?.gears.find(item => item.id === (mesh.gearAId === gear!.id ? mesh.gearBId : mesh.gearAId));
      const pivot = mate && tr?.axles.find(axle => axle.id === mate.axleId);
      let point = { x: action.x, y: action.y };
      const speeds = gear && tr && calculateTransmissionSpeeds(tr,gear.id,1).speeds;
      const output = speeds && (sketch.drive?.outputId && sketch.drive.outputId in speeds ? sketch.drive.outputId :
        [...sketch.pulleys,...tr!.gears].filter(p=>p.id in speeds).at(-1)?.id);
      if (gear && output === gear.id && tr) {
        const members = new Set([gear.id]);
        const links = [...tr.axles.map(a=>a.componentIds), ...tr.meshes.map(m=>[m.gearAId,m.gearBId]),
          ...sketch.constraints.map(c=>[c.firstId,c.secondId]), ...sketch.dimensions.flatMap(d=>d.toId?[[d.fromId,d.toId]]:[])];
        let previous = 0;
        while (previous !== members.size) {
          previous = members.size;
          for (const ids of links) if (ids.some(id=>members.has(id))) ids.forEach(id=>members.add(id));
        }
        for (const id of members) {
          const before = findObject(sketch,id);
          if (!before) continue;
          // Process a shared shaft once; replacePosition moves all its members.
          const axle = tr.axles.find(a=>a.componentIds.includes(id));
          if (axle && axle.componentIds[0] !== id) continue;
          sketch = replacePosition(sketch,id,{x:before.x+point.x-current.x,y:before.y+point.y-current.y});
        }
      }
      if (mesh && gear && mate && pivot && tr && output !== gear.id) {
        const direction = { x: point.x - pivot.x, y: point.y - pivot.y };
        if (!direction.x && !direction.y) return sketch;
        point = tangentGearPosition(pivot, direction, mate, gear);
        const sign = mesh.gearBId === gear.id ? 1 : -1;
        const angleDeg = Math.atan2(sign * direction.y, sign * direction.x) * 180 / Math.PI;
        sketch = { ...sketch, transmission: { ...tr, meshes: tr.meshes.map(item => item.id === mesh.id ? { ...item, angleDeg } : item) } };
      }
      const moved = solveSketchRelations(replacePosition(sketch, action.id, point), action.id);
      if (!moved) return null;
      return meshesRemainTangent(moved) ? moved : null;
    }
    case 'DELETE_OBJECT': {
      const tr = sketch.transmission;
      if (tr?.gears.some(g => g.id === action.id)) return { ...sketch, dimensions: sketch.dimensions.filter(d => d.fromId !== action.id && d.toId !== action.id), constraints: sketch.constraints.filter(c => c.firstId !== action.id && c.secondId !== action.id), transmission: { ...tr,
        gears: tr.gears.filter(g => g.id !== action.id),
        meshes: tr.meshes.filter(m => m.gearAId !== action.id && m.gearBId !== action.id),
        axles: tr.axles.map(a => ({ ...a, componentIds: a.componentIds.filter(id => id !== action.id) })).filter(a => a.componentIds.length),
      } };
      const pulleys = sketch.pulleys.filter((item) => item.id !== action.id);
      let idlers = sketch.idlers.filter((item) => item.id !== action.id);
      if (pulleys.length === sketch.pulleys.length && idlers.length === sketch.idlers.length) return sketch;
      const hadRouteObject = sketch.route.includes(action.id);
      const deletedOrigin = sketch.pulleys.some(item => item.id === action.id && item.isOrigin);
      const dimensions = sketch.dimensions.filter((item) => item.fromId !== action.id && item.toId !== action.id && (!deletedOrigin || item.toId !== undefined));
      const constraints = sketch.constraints.filter((item) => item.firstId !== action.id && item.secondId !== action.id);
      const rebase = pulleys.length > 0 && !pulleys.some(item => item.isOrigin) ? pulleys[0]! : { x: 0, y: 0 };
      const withOrigin = pulleys.map((item, index) => ({ ...item, x: item.x - rebase.x, y: item.y - rebase.y, isOrigin: index === 0 }));
      idlers = idlers.map(item => ({ ...item, x: item.x - rebase.x, y: item.y - rebase.y }));
      const transmission = sketch.transmission ? {
        ...sketch.transmission,
        axles: sketch.transmission.axles
          .map(axle => ({ ...axle, x: axle.x - rebase.x, y: axle.y - rebase.y, componentIds: axle.componentIds.filter(id => id !== action.id) }))
          .filter(axle => axle.componentIds.length > 0),
        belts: sketch.transmission.belts.map(belt => {
          const closed = belt.route.length >= 3 && belt.route[0] === belt.route.at(-1);
          const members = (closed ? belt.route.slice(0, -1) : belt.route).filter(id => id !== action.id);
          const toothedCount = members.filter(id => pulleys.some(pulley => pulley.id === id)).length;
          const route = closed ? toothedCount >= 2 && members.length >= 2 ? [...members, members[0]!] : [] : members;
          const toothCounts = { ...belt.toothCounts };
          delete toothCounts[action.id];
          const pulleyProfiles = { ...(belt.pulleyProfiles ?? {}) };
          delete pulleyProfiles[action.id];
          return { ...belt, route, toothCounts, pulleyProfiles };
        }),
      } : undefined;
      let route = sketch.route;
      if (hadRouteObject) {
        const closed = route.length >= 3 && route[0] === route.at(-1);
        const ordered = (closed ? route.slice(0, -1) : route).filter((id) => id !== action.id);
        if (closed) {
          const toothedCount = ordered.filter((id) => pulleys.some((pulley) => pulley.id === id)).length;
          route = toothedCount >= 2 && ordered.length >= 2 ? [...ordered, ordered[0]!] : [];
        } else {
          route = ordered;
        }
      }
      return {
        ...sketch,
        pulleys: withOrigin,
        idlers,
        ...(transmission ? { transmission } : {}),
        dimensions,
        constraints,
        route,
        view: { ...sketch.view, centerX: sketch.view.centerX - rebase.x, centerY: sketch.view.centerY - rebase.y },
        ...(sketch.drive ? { drive: {
          ...sketch.drive,
          driverId: sketch.drive.driverId === action.id ? null : sketch.drive.driverId,
          outputId: sketch.drive.outputId === action.id ? null : sketch.drive.outputId,
        } } : {}),
      };
    }
    case 'ADD_DIMENSION': {
      if (!findObject(sketch, action.dimension.fromId)) return sketch;
      if (action.dimension.toId && !findObject(sketch, action.dimension.toId)) return sketch;
      if (action.dimension.fromId === action.dimension.toId || !Number.isFinite(action.dimension.valueMm)
        || !Number.isFinite(action.dimension.offsetMm) || (action.dimension.kind === 'aligned' && action.dimension.valueMm < 0)) return sketch;
      const dimensions = [
        ...sketch.dimensions.filter((item) => item.id !== action.dimension.id),
        action.dimension,
      ];
      return solveSketchRelations({ ...sketch, dimensions }, action.dimension.fromId);
    }
    case 'SET_DIMENSION_VALUE': {
      const dimension = sketch.dimensions.find((item) => item.id === action.id);
      if (!dimension || !Number.isFinite(action.valueMm) || (dimension.kind === 'aligned' && action.valueMm < 0)) return sketch;
      const updated = { ...dimension, valueMm: action.valueMm };
      const dimensions = sketch.dimensions.map((item) => item.id === action.id ? updated : item);
      return solveSketchRelations({ ...sketch, dimensions }, dimension.fromId);
    }
    case 'REMOVE_DIMENSION':
      return { ...sketch, dimensions: sketch.dimensions.filter((item) => item.id !== action.id) };
    case 'ADD_CONSTRAINT': {
      if (!findObject(sketch, action.constraint.firstId) || !findObject(sketch, action.constraint.secondId)) {
        return sketch;
      }
      if (action.constraint.firstId === action.constraint.secondId) return sketch;
      const constraints = [
        ...sketch.constraints.filter((item) => item.id !== action.constraint.id),
        action.constraint,
      ];
      return solveSketchRelations({ ...sketch, constraints }, action.constraint.firstId);
    }
    case 'REMOVE_CONSTRAINT':
      return { ...sketch, constraints: sketch.constraints.filter((item) => item.id !== action.id) };
    case 'ROUTE_CLICK': {
      if (!findObject(sketch, action.objectId)) return sketch;
      const route = sketch.route;
      const closed = route.length >= 3 && route[0] === route.at(-1);
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      if (closed || !transmission.belts.some(belt => belt.id === sketch.activeBeltId)) {
        const next = Math.max(0, ...transmission.belts.map(belt => Number(belt.id.replace(/^B/, '')) || 0)) + 1;
        const stage = reducePresent({ ...sketch, transmission }, { type: 'ADD_BELT_STAGE', id: 'B' + next });
        return stage ? { ...stage, route: [action.objectId] } : sketch;
      }
      if (route.length === 0) return { ...sketch, route: [action.objectId] };
      if (action.objectId === route[0]) {
        return route.length >= 2 ? { ...sketch, route: [...route, action.objectId] } : sketch;
      }
      if (route.includes(action.objectId)) return sketch;
      return { ...sketch, route: [...route, action.objectId] };
    }
    case 'ADD_BELT_STAGE': {
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      if (transmission.belts.some(b => b.id === action.id)) return sketch;
      const belt = { id: action.id, profile: action.profile ?? sketch.profile, route: [], toothCounts: Object.fromEntries(sketch.pulleys.map(p => [p.id, p.toothCount])), pulleyProfiles: {} };
      return { ...sketch, transmission: { ...transmission, belts: [...transmission.belts, belt] }, activeBeltId: belt.id, profile: belt.profile, route: [] };
    }
    case 'SET_ACTIVE_BELT': {
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      if (action.id === null) return { ...sketch, transmission, activeBeltId: null, route: [] };
      const belt = transmission.belts.find(item => item.id === action.id);
      if (!belt) return sketch;
      const pulleys = sketch.pulleys.map(item => belt.route.includes(item.id) ? { ...item, profile: belt.pulleyProfiles?.[item.id] ?? belt.profile } : item);
      return { ...sketch, transmission, activeBeltId: belt.id, profile: belt.profile, route: [...belt.route], pulleys };
    }
    case 'SET_PULLEY_BELT': {
      const pulley = sketch.pulleys.find(item => item.id === action.id);
      if (!pulley) return sketch;
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      if (action.beltId !== null && !transmission.belts.some(belt => belt.id === action.beltId)) return sketch;
      if (action.beltId !== null && hasOtherPulleyOnBeltAxle(sketch, pulley.id, action.beltId)) return sketch;
      const removePulley = (route: string[]) => {
        const closed = route.length >= 3 && route[0] === route.at(-1);
        const members = (closed ? route.slice(0, -1) : route).filter(id => id !== pulley.id);
        if (!closed) return members;
        const toothed = members.filter(id => sketch.pulleys.some(item => item.id === id)).length;
        return toothed >= 2 ? [...members, members[0]!] : members;
      };
      const belts = transmission.belts.map(belt => {
        if (belt.id !== action.beltId && !belt.route.includes(pulley.id)) return belt;
        const route = belt.id === action.beltId
          ? belt.route
          : removePulley(belt.route);
        if (belt.id !== action.beltId) {
          const pulleyProfiles = { ...(belt.pulleyProfiles ?? {}) };
          delete pulleyProfiles[pulley.id];
          const toothCounts = { ...belt.toothCounts };
          delete toothCounts[pulley.id];
          return { ...belt, route, pulleyProfiles, toothCounts };
        }
        const closed = route.length >= 3 && route[0] === route.at(-1);
        const members = closed ? route.slice(0, -1) : route;
        const nextRoute = members.includes(pulley.id)
          ? route
          : closed ? [...members, pulley.id, members[0]!] : [...route, pulley.id];
        return {
          ...belt,
          route: nextRoute,
          toothCounts: { ...belt.toothCounts, [pulley.id]: pulley.toothCount },
          pulleyProfiles: { ...(belt.pulleyProfiles ?? {}), [pulley.id]: belt.profile },
        };
      });
      const activeBeltId = sketch.activeBeltId;
      const active = belts.find(belt => belt.id === activeBeltId);
      const pulleys = active
        ? sketch.pulleys.map(item => active.route.includes(item.id) ? { ...item, profile: active.pulleyProfiles?.[item.id] ?? active.profile } : item)
        : sketch.pulleys;
      return {
        ...sketch,
        transmission: { ...transmission, belts },
        activeBeltId,
        ...(active ? { route: [...active.route], profile: active.profile } : {}),
        pulleys,
      };
    }
    case 'CLEAR_ROUTE':
      return {
        ...sketch,
        route: [],
        idlers: sketch.idlers.map(idler => sketch.route.includes(idler.id) ? { ...idler, beltId: null, locked: false } : idler),
        drive: { driverId: null, outputId: null, driverRpm: sketch.drive?.driverRpm ?? null },
      };
    case 'SET_DRIVE': {
      const routes = sketch.transmission?.belts.map(belt => belt.route) ?? [sketch.route];
      const connected = (id: string | null | undefined) => id && (sketch.transmission?.gears.some(g => g.id === id) || sketch.pulleys.some(p => p.id === id) && (routes.some(route => route.includes(id)) || sketch.transmission?.axles.some(a => a.componentIds.includes(id) && a.componentIds.length > 1))) ? id : null;
      const drive = {
        ...sketch.drive,
        driverRpm: sketch.drive?.driverRpm ?? null,
        driverId: connected(sketch.drive?.driverId), outputId: connected(sketch.drive?.outputId),
        ...action.changes,
      };
      if (drive.driverRpm !== null && (!Number.isFinite(drive.driverRpm) || drive.driverRpm < 0)) return sketch;
      for (const id of [drive.driverId, drive.outputId]) {
        if (id !== null && !connected(id)) return sketch;
      }
      return { ...sketch, drive };
    }
    case 'SET_PROFILE':
    case 'SET_BELT_PROFILE': {
      if (action.type === 'SET_BELT_PROFILE' && sketch.activeBeltId === null) return sketch;
      const transmission = sketch.transmission ?? migrateLegacyTransmission(sketch);
      const active = transmission.belts.find(belt => belt.id === sketch.activeBeltId) ?? transmission.belts[0];
      if (!active) return { ...sketch, profile: action.profile };
      const pulleyProfiles = { ...(active.pulleyProfiles ?? {}) };
      for (const id of active.route) if (sketch.pulleys.some(p => p.id === id)) pulleyProfiles[id] = action.profile;
      return { ...sketch, profile: action.profile, pulleys: sketch.pulleys.map(p => active.route.includes(p.id) ? { ...p, profile: action.profile } : p), transmission: { ...transmission, belts: transmission.belts.map(b => b.id === active.id ? { ...b, profile: action.profile, pulleyProfiles } : b) }, activeBeltId: active.id };
    }
    case 'SET_TOLERANCE':
      return Number.isFinite(action.value) && action.value >= 0
        ? { ...sketch, toleranceTeeth: action.value }
        : sketch;
    case 'SET_AVAILABLE_BELTS':
      return {
        ...sketch,
        availableBeltTeeth: [...new Set(action.values.filter((value) => Number.isInteger(value) && value > 0))],
      };
    case 'SET_VIEW':
      return { ...sketch, view: action.view };
    case 'NEW_SKETCH':
      return createEmptySketch();
    case 'LOAD_SKETCH':
      return action.sketch;
    case 'BEGIN_DRAG':
    case 'END_DRAG':
      return sketch;
  }
}

export function reduceSketch(state: HistoryState, action: SketchAction): HistoryState {
  if (action.type === 'SET_VIEW') {
    if (!Number.isFinite(action.view.centerX) || !Number.isFinite(action.view.centerY)
      || !Number.isFinite(action.view.zoom) || action.view.zoom <= 0) return state;
    if (state.present.view.centerX === action.view.centerX
      && state.present.view.centerY === action.view.centerY
      && state.present.view.zoom === action.view.zoom) return state;
    return { ...state, present: { ...state.present, view: action.view } };
  }

  if (action.type === 'UNDO') {
    if (state.activeEdit) {
      return { ...state, present: state.activeEdit.before, activeEdit: null };
    }
    if (state.past.length === 0) return state;
    const present = state.past[state.past.length - 1]!;
    return {
      past: state.past.slice(0, -1),
      present,
      future: [state.present, ...state.future],
      activeEdit: null,
    };
  }

  if (action.type === 'REDO') {
    if (state.activeEdit || state.future.length === 0) return state;
    const [present, ...future] = state.future;
    return {
      past: [...state.past.slice(-99), state.present],
      present: present!,
      future,
      activeEdit: null,
    };
  }

  if (action.type === 'BEGIN_DRAG') {
    const object = findObject(state.present, action.id);
    if (!object || object.isOrigin || state.activeEdit) return state;
    return { ...state, activeEdit: { id: action.id, before: state.present } };
  }

  if (action.type === 'END_DRAG') {
    return finishActiveEdit(state.activeEdit ? { ...state, present: snapDraggedGear(state.present, state.activeEdit.id) } : state);
  }

  let present = reducePresent(state.present, action);
  if (present && (present.transmission || action.type === 'ROUTE_CLICK' || action.type === 'CLEAR_ROUTE' || action.type === 'SET_PROFILE' || action.type === 'SET_BELT_PROFILE')) present = syncActiveBelt(present);
  if (present === null) return { ...state, notice: 'That edit conflicts with existing dimensions or constraints.' };
  if (state.activeEdit && (action.type === 'LATCH_IDLER' || action.type === 'LATCH_PULLEY' || action.type === 'UNLATCH_IDLER') && state.activeEdit.id === action.id) {
    return finishActiveEdit({ ...state, present });
  }
  if (present === state.present || sameSketch(present, state.present)) return state;
  if (state.activeEdit && action.type === 'MOVE_OBJECT' && state.activeEdit.id === action.id) {
    return { ...state, present };
  }
  return { ...recordChange(finishActiveEdit(state), present), notice: null };
}
