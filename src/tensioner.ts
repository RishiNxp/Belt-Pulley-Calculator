import type { Idler, LineSegment, PathSegment, Point, Sketch } from './model';
import type { Camera, ViewportSize } from './viewport';
import { worldToScreen } from './viewport';
import { beltWinding, calculateBeltGeometry } from './geometry';
import { insertRouteMember } from './state';

function projection(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  return lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
}

export function findBeltSpan(segments: PathSegment[], screen: Point, camera: Camera, size: ViewportSize): LineSegment | null {
  let nearest: LineSegment | null = null;
  let nearestDistance = 12;
  for (const segment of segments) {
    if (segment.kind !== 'line') continue;
    const start = worldToScreen(segment.start, camera, size);
    const end = worldToScreen(segment.end, camera, size);
    const t = projection(screen, start, end);
    const distance = Math.hypot(screen.x - (start.x + t * (end.x - start.x)), screen.y - (start.y + t * (end.y - start.y)));
    if (distance <= nearestDistance) { nearestDistance = distance; nearest = segment; }
  }
  return nearest;
}

export function createTensionerOnSpan(sketch: Sketch, span: LineSegment, click: Point, id: string): Idler | null {
  const route = insertRouteMember(sketch.route, span.fromId, span.toId, id);
  const baseline = calculateBeltGeometry(sketch);
  if (!route || !baseline.valid) return null;
  const dx = span.end.x - span.start.x;
  const dy = span.end.y - span.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  const side = -beltWinding(sketch);
  const outward = { x: -dy / length * side, y: dx / length * side };
  const clickedT = projection(click, span.start, span.end);
  const positions = [...new Set([Math.max(0.1, Math.min(0.9, clickedT)), 0.25, 0.5, 0.75])]
    .sort((a, b) => Math.abs(a - clickedT) - Math.abs(b - clickedT));
  // Prefer 30 mm, reducing it only when the clicked span has insufficient clearance.
  for (let radius = Math.min(15, length * 0.3); radius >= 0.5; radius *= 0.7) {
    const offset = radius - Math.min(5, radius * 0.35);
    for (const t of positions) {
      const idler: Idler = {
        id, label: id, diameterMm: radius * 2,
        x: span.start.x + t * dx + outward.x * offset,
        y: span.start.y + t * dy + outward.y * offset,
      };
      const geometry = calculateBeltGeometry({ ...sketch, route, idlers: [...sketch.idlers, idler] });
      if (geometry.valid && geometry.lengthMm! > baseline.lengthMm! + 1e-7) return idler;
    }
  }
  return null;
}
