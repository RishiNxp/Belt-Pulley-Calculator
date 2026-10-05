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

export type SketchAction =
  | { type: 'ADD_PULLEY'; pulley: Pulley; segment?: { fromId: string; toId: string } }
  | { type: 'ADD_IDLER'; idler: Idler; segment?: { fromId: string; toId: string } }
  | { type: 'UPDATE_PULLEY'; id: string; changes: Partial<Pick<Pulley, 'label' | 'toothCount' | 'profile'>> }
  | { type: 'UPDATE_IDLER'; id: string; changes: Partial<Pick<Idler, 'label' | 'diameterMm'>> }
  | { type: 'MOVE_OBJECT'; id: string; x: number; y: number }
  | { type: 'BEGIN_DRAG'; id: string }
  | { type: 'END_DRAG' }
  | { type: 'DELETE_OBJECT'; id: string }
  | { type: 'ADD_DIMENSION'; dimension: SketchDimension }
  | { type: 'SET_DIMENSION_VALUE'; id: string; valueMm: number }
  | { type: 'REMOVE_DIMENSION'; id: string }
  | { type: 'ADD_CONSTRAINT'; constraint: SketchConstraint }
  | { type: 'REMOVE_CONSTRAINT'; id: string }
  | { type: 'ROUTE_CLICK'; objectId: string }
  | { type: 'CLEAR_ROUTE' }
  | { type: 'SET_DRIVE'; changes: Partial<NonNullable<Sketch['drive']>> }
  | { type: 'SET_PROFILE'; profile: BeltProfile }
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

function findObject(sketch: Sketch, id: string): LocatedObject | undefined {
  const pulley = sketch.pulleys.find((item) => item.id === id);
  if (pulley) return pulley;
  const idler = sketch.idlers.find((item) => item.id === id);
  return idler ? { ...idler, isOrigin: false } : undefined;
}

function replacePosition(sketch: Sketch, id: string, point: Point): Sketch {
  const pulley = sketch.pulleys.find((item) => item.id === id);
  if (pulley) {
    if (pulley.isOrigin || (pulley.x === point.x && pulley.y === point.y)) return sketch;
    return {
      ...sketch,
      pulleys: sketch.pulleys.map((item) => item.id === id ? { ...item, ...point } : item),
    };
  }

  const idler = sketch.idlers.find((item) => item.id === id);
  if (!idler || (idler.x === point.x && idler.y === point.y)) return sketch;
  return {
    ...sketch,
    idlers: sketch.idlers.map((item) => item.id === id ? { ...item, ...point } : item),
  };
}

function sameSketch(first: Sketch, second: Sketch): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
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

function reducePresent(sketch: Sketch, action: Exclude<SketchAction, { type: 'UNDO' | 'REDO' }>): Sketch | null {
  switch (action.type) {
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
        pulleys: [...sketch.pulleys.map((item) => ({ ...item, profile })), pulley],
        route,
      };
    }
    case 'ADD_IDLER': {
      if (findObject(sketch, action.idler.id)) return sketch;
      if (!Number.isFinite(action.idler.diameterMm) || action.idler.diameterMm <= 0
        || !Number.isFinite(action.idler.x) || !Number.isFinite(action.idler.y)) return sketch;
      let route = sketch.route;
      if (action.segment) {
        const inserted = insertRouteMember(route, action.segment.fromId, action.segment.toId, action.idler.id);
        if (!inserted) return sketch;
        route = inserted;
      }
      return { ...sketch, idlers: [...sketch.idlers, action.idler], route };
    }
    case 'UPDATE_PULLEY': {
      if (!sketch.pulleys.some((item) => item.id === action.id)) return sketch;
      if (action.changes.toothCount !== undefined && (!Number.isInteger(action.changes.toothCount) || action.changes.toothCount <= 0)) return sketch;
      const profile = action.changes.profile ?? sketch.profile;
      return {
        ...sketch,
        profile,
        pulleys: sketch.pulleys.map((item) => item.id === action.id
          ? { ...item, ...action.changes, profile }
          : { ...item, profile }),
      };
    }
    case 'UPDATE_IDLER':
      if (action.changes.diameterMm !== undefined && (!Number.isFinite(action.changes.diameterMm) || action.changes.diameterMm <= 0)) return sketch;
      return {
        ...sketch,
        idlers: sketch.idlers.map((item) => item.id === action.id ? { ...item, ...action.changes } : item),
      };
    case 'MOVE_OBJECT': {
      const current = findObject(sketch, action.id);
      if (!current || current.isOrigin || !Number.isFinite(action.x) || !Number.isFinite(action.y)) return sketch;
      return solveSketchRelations(replacePosition(sketch, action.id, { x: action.x, y: action.y }), action.id);
    }
    case 'DELETE_OBJECT': {
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
      if (closed) return { ...sketch, route: [action.objectId] };
      if (route.length === 0) return { ...sketch, route: [action.objectId] };
      if (action.objectId === route[0]) {
        return route.length >= 2 ? { ...sketch, route: [...route, action.objectId] } : sketch;
      }
      if (route.includes(action.objectId)) return sketch;
      return { ...sketch, route: [...route, action.objectId] };
    }
    case 'CLEAR_ROUTE':
      return { ...sketch, route: [], drive: { driverId: null, outputId: null, driverRpm: sketch.drive?.driverRpm ?? null } };
    case 'SET_DRIVE': {
      const connected = (id: string | null | undefined) => id && sketch.route.includes(id) && sketch.pulleys.some(pulley => pulley.id === id) ? id : null;
      const drive = {
        driverRpm: sketch.drive?.driverRpm ?? null,
        driverId: connected(sketch.drive?.driverId), outputId: connected(sketch.drive?.outputId),
        ...action.changes,
      };
      if (drive.driverRpm !== null && (!Number.isFinite(drive.driverRpm) || drive.driverRpm < 0)) return sketch;
      for (const id of [drive.driverId, drive.outputId]) {
        if (id !== null && (!sketch.route.includes(id) || !sketch.pulleys.some(pulley => pulley.id === id))) return sketch;
      }
      return { ...sketch, drive };
    }
    case 'SET_PROFILE':
      return {
        ...sketch,
        profile: action.profile,
        pulleys: sketch.pulleys.map((item) => ({ ...item, profile: action.profile })),
      };
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
    return finishActiveEdit(state);
  }

  const present = reducePresent(state.present, action);
  if (present === null) return { ...state, notice: 'That edit conflicts with existing dimensions or constraints.' };
  if (present === state.present || sameSketch(present, state.present)) return state;
  if (state.activeEdit && action.type === 'MOVE_OBJECT' && state.activeEdit.id === action.id) {
    return { ...state, present };
  }
  return { ...recordChange(finishActiveEdit(state), present), notice: null };
}
