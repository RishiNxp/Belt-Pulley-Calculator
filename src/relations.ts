import type { Point, Sketch } from './model';

const FIXED = Symbol('fixed origin');
type Key = string | typeof FIXED;
type Axis = 'x' | 'y';
type AxisGroup = { locked: boolean; members: Map<Key, number> };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 + 1e-10 * Math.max(Math.abs(a), Math.abs(b));

// Axis constraints and signed dimensions are exact differences between coordinates.
// Resolve connected components, then solve aligned distances through their free axes.
// Conflicting edits return null; no partial geometry is committed.
export function solveSketchRelations(sketch: Sketch, preferredAnchorId?: string): Sketch | null {
  const points = new Map<Key, Point>([
    [FIXED, { x: 0, y: 0 }],
    ...[...sketch.pulleys, ...sketch.idlers].map(object => [object.id, { x: object.x, y: object.y }] as [Key, Point]),
  ]);

  const solveAxis = (axis: Axis): Map<Key, AxisGroup> | null => {
    const graph = new Map([...points.keys()].map(id => [id, [] as { id: Key; difference: number }[]]));
    const connect = (from: Key, to: Key, difference: number) => {
      graph.get(from)?.push({ id: to, difference });
      graph.get(to)?.push({ id: from, difference: -difference });
    };
    for (const pulley of sketch.pulleys) if (pulley.isOrigin) connect(FIXED, pulley.id, 0);
    for (const constraint of sketch.constraints) {
      if ((constraint.kind === 'vertical' ? 'x' : 'y') === axis) connect(constraint.firstId, constraint.secondId, 0);
    }
    for (const dimension of sketch.dimensions) {
      if (dimension.kind !== (axis === 'x' ? 'horizontal' : 'vertical')) continue;
      connect(dimension.toId ? dimension.fromId : FIXED, dimension.toId ?? dimension.fromId, dimension.valueMm);
    }
    const groups = new Map<Key, AxisGroup>();
    const ordered: Key[] = [FIXED, ...(preferredAnchorId ? [preferredAnchorId] : []), ...points.keys()];
    for (const seed of ordered) {
      if (groups.has(seed) || !points.has(seed)) continue;
      const group: AxisGroup = { locked: false, members: new Map([[seed, 0]]) };
      const queue: Key[] = [seed];
      for (let index = 0; index < queue.length; index++) {
        const id = queue[index]!;
        for (const edge of graph.get(id)!) {
          const offset = group.members.get(id)! + edge.difference;
          if (!Number.isFinite(offset)) return null;
          if (group.members.has(edge.id)) {
            if (!close(group.members.get(edge.id)!, offset)) return null;
          } else {
            group.members.set(edge.id, offset);
            queue.push(edge.id);
          }
        }
      }
      group.locked = group.members.has(FIXED);
      const base = group.locked ? -group.members.get(FIXED)! : points.get(seed)![axis];
      for (const [id, offset] of group.members) {
        points.get(id)![axis] = base + offset;
        groups.set(id, group);
      }
    }
    return groups;
  };

  const xGroups = solveAxis('x');
  const yGroups = solveAxis('y');
  if (!xGroups || !yGroups) return null;

  const moveGroup = (id: Key, axis: Axis, coordinate: number) => {
    const groups = axis === 'x' ? xGroups : yGroups;
    const group = groups.get(id)!;
    const base = coordinate - group.members.get(id)!;
    for (const [member, offset] of group.members) points.get(member)![axis] = base + offset;
  };
  const aligned = sketch.dimensions.filter(dimension => dimension.kind === 'aligned');
  const satisfied = () => aligned.every(dimension => {
    const first = points.get(dimension.toId ? dimension.fromId : FIXED)!;
    const second = points.get(dimension.toId ?? dimension.fromId)!;
    return close(Math.hypot(second.x - first.x, second.y - first.y), dimension.valueMm);
  });

  const maxPasses = Math.min(96, Math.max(8, aligned.length * 12));
  for (let pass = 0; pass < maxPasses && !satisfied(); pass++) {
    for (const dimension of aligned) {
      if (!Number.isFinite(dimension.valueMm) || dimension.valueMm < 0) return null;
      const firstId: Key = dimension.toId ? dimension.fromId : FIXED;
      const secondId = dimension.toId ?? dimension.fromId;
      const first = points.get(firstId)!;
      const second = points.get(secondId)!;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const length = Math.hypot(dx, dy);
      if (close(length, dimension.valueMm)) continue;
      const movable = (groups: Map<Key, AxisGroup>): Key | null => {
        if (groups.get(firstId) === groups.get(secondId)) return null;
        if (!groups.get(secondId)!.locked) return secondId;
        return groups.get(firstId)!.locked ? null : firstId;
      };
      const movingX = movable(xGroups);
      const movingY = movable(yGroups);
      let targetDx = dx;
      let targetDy = dy;
      if (movingX !== null && movingY !== null) {
        targetDx = dimension.valueMm * (length > 1e-9 ? dx / length : 1);
        targetDy = dimension.valueMm * (length > 1e-9 ? dy / length : 0);
      } else if (movingX !== null) {
        if (Math.abs(dy) > dimension.valueMm + 1e-7) return null;
        targetDx = (dx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, dimension.valueMm ** 2 - dy ** 2));
      } else if (movingY !== null) {
        if (Math.abs(dx) > dimension.valueMm + 1e-7) return null;
        targetDy = (dy < 0 ? -1 : 1) * Math.sqrt(Math.max(0, dimension.valueMm ** 2 - dx ** 2));
      } else return null;
      // Capture both requested coordinates before a shared component is moved.
      const x = movingX === secondId ? first.x + targetDx : second.x - targetDx;
      const y = movingY === secondId ? first.y + targetDy : second.y - targetDy;
      if (movingX !== null) moveGroup(movingX, 'x', x);
      if (movingY !== null) moveGroup(movingY, 'y', y);
    }
  }
  if (!satisfied() || [...points.values()].some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const position = <T extends { id: string; x: number; y: number }>(object: T): T => {
    const point = points.get(object.id)!;
    return point.x === object.x && point.y === object.y ? object : { ...object, ...point };
  };
  return { ...sketch, pulleys: sketch.pulleys.map(position), idlers: sketch.idlers.map(position) };
}
