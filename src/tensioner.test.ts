import { describe, expect, it } from 'vitest';
import { createDemoSketch } from './demo';
import { calculateBeltGeometry } from './geometry';
import { createTensionerOnSpan, findBeltSpan } from './tensioner';
import { reduceSketch } from './state';
import { worldToScreen } from './viewport';
import type { LineSegment, Sketch } from './model';

function insert(sketch: Sketch, span: LineSegment, id = 'T1') {
  const click = { x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 };
  const idler = createTensionerOnSpan(sketch, span, click, id);
  expect(idler).not.toBeNull();
  return reduceSketch({ present: sketch, past: [], future: [], activeEdit: null }, {
    type: 'ADD_IDLER', idler: idler!, segment: { fromId: span.fromId, toId: span.toId },
  }).present;
}

describe('tensioner creation', () => {
  it('hit tests the same span with a generous screen target after pan and zoom', () => {
    const segments = calculateBeltGeometry(createDemoSketch()).segments;
    const span = segments.find(s => s.kind === 'line') as LineSegment;
    const size = { width: 900, height: 600 };
    for (const camera of [{ centerX: 30, centerY: -100, zoom: 0.5 }, { centerX: 80, centerY: 40, zoom: 3 }]) {
      const point = worldToScreen({ x: (span.start.x + span.end.x) / 2, y: (span.start.y + span.end.y) / 2 }, camera, size);
      expect(findBeltSpan(segments, { x: point.x, y: point.y + 7 }, camera, size)?.fromId).toBe('P1');
      expect(findBeltSpan(segments, { x: -1000, y: -1000 }, camera, size)).toBeNull();
    }
  });

  it('inserts a real smooth contact on the clicked edge and deletion restores its length', () => {
    const original = createDemoSketch();
    const before = calculateBeltGeometry(original);
    const span = before.segments.find(s => s.kind === 'line') as LineSegment;
    const added = insert(original, span);
    const geometry = calculateBeltGeometry(added);
    expect(added.route).toEqual(['P1', 'T1', 'P2', 'P3', 'P4', 'P1']);
    expect(geometry.valid).toBe(true);
    expect(geometry.lengthMm).toBeGreaterThan(before.lengthMm!);
    expect(geometry.exactTeeth).not.toBe(before.exactTeeth);
    const deleted = reduceSketch({ present: added, past: [], future: [], activeEdit: null }, { type: 'DELETE_OBJECT', id: 'T1' }).present;
    expect(deleted.route).toEqual(original.route);
    expect(calculateBeltGeometry(deleted).lengthMm).toBeCloseTo(before.lengthMm!, 9);
  });

  it('chooses a fitting default diameter for a short span instead of overlapping its pulleys', () => {
    const sketch = createDemoSketch();
    const span = calculateBeltGeometry(sketch).segments.find(s => s.kind === 'line' && s.fromId === 'P3') as LineSegment;
    const added = insert(sketch, span);
    expect(added.idlers[0]!.diameterMm).toBeLessThan(30);
    expect(calculateBeltGeometry(added).valid).toBe(true);
  });

  it('keeps the closing edge identity and supports a second idler', () => {
    let sketch = createDemoSketch();
    const firstSpan = calculateBeltGeometry(sketch).segments.find(s => s.kind === 'line' && s.fromId === 'P1') as LineSegment;
    sketch = insert(sketch, firstSpan, 'T1');
    const closingSpan = calculateBeltGeometry(sketch).segments.find(s => s.kind === 'line' && s.toId === 'P1') as LineSegment;
    sketch = insert(sketch, closingSpan, 'T2');
    expect(sketch.route).toEqual(['P1', 'T1', 'P2', 'P3', 'P4', 'T2', 'P1']);
    expect(calculateBeltGeometry(sketch).valid).toBe(true);
  });
});
