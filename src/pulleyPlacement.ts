import { beltWinding, calculateBeltGeometry, pitchDiameter } from './geometry';
import type { LineSegment, Point, Pulley, Sketch } from './model';
import { insertRouteMember } from './state';

export function createPulleyOnSpan(sketch: Sketch, span: LineSegment, click: Point, id: string): Pulley | null {
  const route = insertRouteMember(sketch.route, span.fromId, span.toId, id);
  const baseline = calculateBeltGeometry(sketch);
  if (!route || !baseline.valid) return null;

  const dx = span.end.x - span.start.x;
  const dy = span.end.y - span.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  const clickedT = Math.max(0, Math.min(1,
    ((click.x - span.start.x) * dx + (click.y - span.start.y) * dy) / (length * length),
  ));
  const side = -beltWinding(sketch);
  const outward = { x: -dy / length * side, y: dx / length * side };
  const radius = pitchDiameter(sketch.profile, 20) / 2;
  const positions = [...new Set([Math.max(0.1, Math.min(0.9, clickedT)), 0.25, 0.5, 0.75])];
  const candidates = positions.flatMap(t => [0, 0.5, 1, 1.5, 2].map(multiplier => ({
    t, offset: radius * multiplier,
  }))).sort((a, b) =>
    Math.hypot((a.t - clickedT) * length, a.offset) - Math.hypot((b.t - clickedT) * length, b.offset),
  );

  // Keep the click's location when possible; otherwise find nearby clearance.
  // Every candidate must have a real toothed contact in the canonical belt path.
  for (const { t, offset } of candidates) {
    const pulley: Pulley = {
      id, label: id, toothCount: 20, profile: sketch.profile, isOrigin: false,
      x: span.start.x + t * dx + outward.x * offset,
      y: span.start.y + t * dy + outward.y * offset,
    };
    const geometry = calculateBeltGeometry({ ...sketch, route, pulleys: [...sketch.pulleys, pulley] });
    if (geometry.valid && geometry.lengthMm! > baseline.lengthMm! + 1e-7) return pulley;
  }
  return null;
}
