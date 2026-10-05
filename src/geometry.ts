import type {
  ArcSegment,
  BeltGeometryResult,
  BeltProfile,
  Idler,
  LineSegment,
  PathSegment,
  Point,
  Pulley,
  Sketch,
} from './model';

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

type BeltObject =
  | (Pulley & { kind: 'pulley'; radiusMm: number; signedRadiusMm: number })
  | (Idler & { kind: 'idler'; radiusMm: number; signedRadiusMm: number });

type Tangent = {
  from: BeltObject;
  to: BeltObject;
  start: Point;
  end: Point;
  lengthMm: number;
};

type SolvedPath = {
  segments: PathSegment[];
  lengthMm: number;
  wrapAngles: Record<string, number>;
};

const profilePitches: Record<BeltProfile, number> = {
  GT2: 2,
  GT3: 3,
  'HTD 5M': 5,
};

export function pitchForProfile(profile: BeltProfile): number {
  return profilePitches[profile];
}

export function pitchDiameter(profile: BeltProfile, teeth: number): number {
  return (teeth * pitchForProfile(profile)) / Math.PI;
}

function emptyResult(sketch: Sketch, diagnostic: string): BeltGeometryResult {
  const pitchMm = profilePitches[sketch.profile] ?? 0;
  return {
    valid: false,
    diagnostic,
    segments: [],
    lengthMm: null,
    pitchMm,
    exactTeeth: null,
    nearestTeeth: null,
    lowerTeeth: null,
    higherTeeth: null,
    nearestLengthErrorMm: null,
    nearestToothError: null,
    passesTolerance: null,
    bestAvailableTeeth: null,
    bestAvailableLengthErrorMm: null,
    wrapAngles: {},
    idlerContributions: [],
  };
}

function getArea(route: BeltObject[]): number {
  return route.reduce((area, current, index) => {
    const next = route[(index + 1) % route.length]!;
    return area + current.x * next.y - next.x * current.y;
  }, 0) / 2;
}

export function beltWinding(sketch: Sketch): 1 | -1 {
  const pulleys = new Map(sketch.pulleys.map(pulley => [pulley.id, pulley]));
  const points = sketch.route.slice(0, -1).flatMap(id => pulleys.get(id) ?? []);
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return area > EPSILON ? 1 : -1;
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function directedSweep(startAngle: number, endAngle: number, direction: 1 | -1): number {
  return direction === 1
    ? positiveModulo(endAngle - startAngle, TAU)
    : -positiveModulo(startAngle - endAngle, TAU);
}

function validateSketch(sketch: Sketch): { route: BeltObject[] } | { error: string } {
  const pitch = profilePitches[sketch.profile];
  if (!pitch) return { error: 'Choose GT2, GT3, or HTD 5M for this belt.' };
  if (!Number.isFinite(sketch.toleranceTeeth) || sketch.toleranceTeeth < 0) {
    return { error: 'Tooth tolerance must be zero or greater.' };
  }
  if (sketch.route.length < 3 || sketch.route[0] !== sketch.route.at(-1)) {
    return { error: 'Route must close by returning to its starting object.' };
  }

  const uniqueIds = sketch.route.slice(0, -1);
  if (new Set(uniqueIds).size !== uniqueIds.length) {
    return { error: 'Route cannot visit the same object twice before closing.' };
  }

  const pulleys = new Map(sketch.pulleys.map((pulley) => [pulley.id, pulley]));
  const idlers = new Map(sketch.idlers.map((idler) => [idler.id, idler]));
  const route: BeltObject[] = [];

  for (const id of uniqueIds) {
    const pulley = pulleys.get(id);
    if (pulley) {
      if (!Number.isInteger(pulley.toothCount) || pulley.toothCount <= 0) {
        return { error: `${pulley.label} must have a positive whole tooth count.` };
      }
      if (pulley.profile !== sketch.profile) {
        return { error: `${pulley.label} uses ${pulley.profile}; the belt uses ${sketch.profile}.` };
      }
      if (!Number.isFinite(pulley.x) || !Number.isFinite(pulley.y)) {
        return { error: `${pulley.label} has an invalid position.` };
      }
      const radiusMm = pitchDiameter(pulley.profile, pulley.toothCount) / 2;
      route.push({ ...pulley, kind: 'pulley', radiusMm, signedRadiusMm: radiusMm });
      continue;
    }

    const idler = idlers.get(id);
    if (!idler) return { error: `Route object ${id} does not exist.` };
    if (!Number.isFinite(idler.diameterMm) || idler.diameterMm <= 0) {
      return { error: `${idler.label} must have a diameter greater than zero.` };
    }
    if (!Number.isFinite(idler.x) || !Number.isFinite(idler.y)) {
      return { error: `${idler.label} has an invalid position.` };
    }
    const radiusMm = idler.diameterMm / 2;
    route.push({ ...idler, kind: 'idler', radiusMm, signedRadiusMm: -radiusMm });
  }

  if (route.filter((item) => item.kind === 'pulley').length < 2) {
    return { error: 'A belt route needs at least two toothed pulleys.' };
  }

  for (let i = 0; i < route.length; i += 1) {
    for (let j = i + 1; j < route.length; j += 1) {
      const first = route[i]!;
      const second = route[j]!;
      if (distance(first, second) < first.radiusMm + second.radiusMm - EPSILON) {
        return { error: `${first.label} overlaps ${second.label}.` };
      }
    }
  }

  return { route };
}

function makeTangents(route: BeltObject[], branch: 1 | -1): Tangent[] | string {
  const tangents: Tangent[] = [];

  for (let index = 0; index < route.length; index += 1) {
    const from = route[index]!;
    const to = route[(index + 1) % route.length]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const centerDistance = Math.hypot(dx, dy);
    const radiusDifference = from.signedRadiusMm - to.signedRadiusMm;

    if (centerDistance <= Math.abs(radiusDifference) + EPSILON) {
      return `A belt tangent between ${from.label} and ${to.label} is impossible.`;
    }

    const along = radiusDifference / centerDistance;
    const across = Math.sqrt(Math.max(0, 1 - along * along));
    const normal = {
      x: (dx / centerDistance) * along - branch * (dy / centerDistance) * across,
      y: (dy / centerDistance) * along + branch * (dx / centerDistance) * across,
    };
    const start = {
      x: from.x + normal.x * from.signedRadiusMm,
      y: from.y + normal.y * from.signedRadiusMm,
    };
    const end = {
      x: to.x + normal.x * to.signedRadiusMm,
      y: to.y + normal.y * to.signedRadiusMm,
    };
    const lengthMm = distance(start, end);

    if (!Number.isFinite(lengthMm) || lengthMm <= EPSILON) {
      return `A belt tangent between ${from.label} and ${to.label} has zero length.`;
    }

    tangents.push({ from, to, start, end, lengthMm });
  }

  return tangents;
}

function pointToSegmentDistance(point: Point, line: Tangent): number {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const squaredLength = dx * dx + dy * dy;
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - line.start.x) * dx + (point.y - line.start.y) * dy) / squaredLength),
  );
  return Math.hypot(point.x - (line.start.x + projection * dx), point.y - (line.start.y + projection * dy));
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function lineSegmentsCross(first: Tangent, second: Tangent): boolean {
  const o1 = orientation(first.start, first.end, second.start);
  const o2 = orientation(first.start, first.end, second.end);
  const o3 = orientation(second.start, second.end, first.start);
  const o4 = orientation(second.start, second.end, first.end);
  if (o1 * o2 < -EPSILON && o3 * o4 < -EPSILON) return true;
  const onSegment = (point: Point, line: Tangent) => pointToSegmentDistance(point, line) <= EPSILON;
  return (Math.abs(o1) <= EPSILON && onSegment(second.start, first))
    || (Math.abs(o2) <= EPSILON && onSegment(second.end, first))
    || (Math.abs(o3) <= EPSILON && onSegment(first.start, second))
    || (Math.abs(o4) <= EPSILON && onSegment(first.end, second));
}

function checkRouteIntersections(route: BeltObject[], tangents: Tangent[]): string | null {
  for (let i = 0; i < tangents.length; i += 1) {
    const first = tangents[i]!;
    for (let j = i + 1; j < tangents.length; j += 1) {
      const second = tangents[j]!;
      if (lineSegmentsCross(first, second)) return 'Belt route crosses itself.';
    }
    for (const item of route) {
      if (item.id === first.from.id || item.id === first.to.id) continue;
      if (pointToSegmentDistance(item, first) < item.radiusMm - EPSILON) {
        return `${item.label} blocks a belt tangent.`;
      }
    }
  }
  return null;
}

function solvePath(route: BeltObject[]): SolvedPath | string {
  // Idler motion must not reverse the winding of the toothed pulley route.
  const toothedRoute = route.filter(object => object.kind === 'pulley');
  const area = getArea(toothedRoute);
  if (toothedRoute.length > 2 && Math.abs(area) <= EPSILON) {
    return 'Belt route is collinear and has no unique wrap direction.';
  }

  const direction: 1 | -1 = area > EPSILON ? 1 : -1;
  const outerBranch: 1 | -1 = direction === 1 ? -1 : 1;
  const tangents = makeTangents(route, outerBranch);
  if (typeof tangents === 'string') return tangents;

  const intersectionError = checkRouteIntersections(route, tangents);
  if (intersectionError) return intersectionError;

  const arcs: ArcSegment[] = route.map((object, index) => {
    const incoming = tangents[(index + route.length - 1) % route.length]!.end;
    const outgoing = tangents[index]!.start;
    const startAngle = Math.atan2(incoming.y - object.y, incoming.x - object.x);
    const contactDirection = object.kind === 'idler' ? (direction === 1 ? -1 : 1) : direction;
    const endAngle = startAngle + directedSweep(
      startAngle,
      Math.atan2(outgoing.y - object.y, outgoing.x - object.x),
      contactDirection,
    );
    const lengthMm = object.radiusMm * Math.abs(endAngle - startAngle);
    return {
      kind: 'arc',
      componentId: object.id,
      center: { x: object.x, y: object.y },
      radiusMm: object.radiusMm,
      startAngle,
      endAngle,
      contactFace: object.kind === 'idler' ? 'smooth' : 'teeth',
      lengthMm,
    };
  });

  if (arcs.some((arc) => !Number.isFinite(arc.lengthMm) || arc.lengthMm <= EPSILON)) {
    return 'Belt route has a pulley with no usable wrap arc.';
  }

  const segments: PathSegment[] = [];
  const wrapAngles: Record<string, number> = {};
  for (let index = 0; index < route.length; index += 1) {
    const tangent = tangents[index]!;
    const line: LineSegment = {
      kind: 'line',
      componentId: tangent.from.id,
      fromId: tangent.from.id,
      toId: tangent.to.id,
      start: tangent.start,
      end: tangent.end,
      lengthMm: tangent.lengthMm,
    };
    segments.push(line, arcs[(index + 1) % route.length]!);
  }
  for (const arc of arcs) wrapAngles[arc.componentId] = Math.abs(arc.endAngle - arc.startAngle);

  const lengthMm = segments.reduce((sum, segment) => sum + segment.lengthMm, 0);
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return 'Belt route has an invalid path length.';
  return { segments, lengthMm, wrapAngles };
}

function toObjectMaps(sketch: Sketch): Map<string, BeltObject> {
  const items = new Map<string, BeltObject>();
  for (const pulley of sketch.pulleys) {
    const radiusMm = pitchDiameter(pulley.profile, pulley.toothCount) / 2;
    items.set(pulley.id, { ...pulley, kind: 'pulley', radiusMm, signedRadiusMm: radiusMm });
  }
  for (const idler of sketch.idlers) {
    const radiusMm = idler.diameterMm / 2;
    items.set(idler.id, { ...idler, kind: 'idler', radiusMm, signedRadiusMm: -radiusMm });
  }
  return items;
}

function resultFromPath(sketch: Sketch, solved: SolvedPath, idlerContributions: BeltGeometryResult['idlerContributions']): BeltGeometryResult {
  const pitchMm = pitchForProfile(sketch.profile);
  const exactTeeth = solved.lengthMm / pitchMm;
  const nearestTeeth = Math.round(exactTeeth);
  const lowerTeeth = Math.floor(exactTeeth);
  const higherTeeth = Math.ceil(exactTeeth);
  const nearestToothError = exactTeeth - nearestTeeth;
  const available = [...new Set(sketch.availableBeltTeeth)]
    .filter((teeth) => Number.isInteger(teeth) && teeth > 0)
    .sort((first, second) => Math.abs(first - exactTeeth) - Math.abs(second - exactTeeth) || first - second);
  const bestAvailableTeeth = available[0] ?? null;

  return {
    valid: true,
    diagnostic: null,
    segments: solved.segments,
    lengthMm: solved.lengthMm,
    pitchMm,
    exactTeeth,
    nearestTeeth,
    lowerTeeth,
    higherTeeth,
    nearestLengthErrorMm: solved.lengthMm - nearestTeeth * pitchMm,
    nearestToothError,
    passesTolerance: Math.abs(nearestToothError) <= sketch.toleranceTeeth + EPSILON,
    bestAvailableTeeth,
    bestAvailableLengthErrorMm: bestAvailableTeeth === null
      ? null
      : solved.lengthMm - bestAvailableTeeth * pitchMm,
    wrapAngles: solved.wrapAngles,
    idlerContributions,
  };
}

export function calculateBeltGeometry(sketch: Sketch): BeltGeometryResult {
  const validation = validateSketch(sketch);
  if ('error' in validation) return emptyResult(sketch, validation.error);

  const itemMap = toObjectMaps(sketch);
  const routeIds = sketch.route.slice(0, -1);
  const route = validation.route;
  const solved = solvePath(route);
  if (typeof solved === 'string') return emptyResult(sketch, solved);

  const idlerContributions = sketch.idlers
    .filter((idler) => routeIds.includes(idler.id))
    .map((idler) => {
      const withoutIdler = route.filter((item) => item.id !== idler.id);
      const baseline = solvePath(withoutIdler);
      return {
        idlerId: idler.id,
        lengthMm: typeof baseline === 'string' ? 0 : solved.lengthMm - baseline.lengthMm,
      };
    });

  // A route-wide overlap/self-intersection check uses the same resolved circle radii as the solver.
  const resolvedRoute = routeIds.map((id) => itemMap.get(id)!);
  if (resolvedRoute.some((item) => !Number.isFinite(item.radiusMm))) {
    return emptyResult(sketch, 'Belt route contains invalid geometry.');
  }

  return resultFromPath(sketch, solved, idlerContributions);
}
