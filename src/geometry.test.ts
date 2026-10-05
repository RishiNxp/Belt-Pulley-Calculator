import { describe, expect, it } from 'vitest';
import { calculateBeltGeometry, pitchDiameter } from './geometry';
import type { BeltProfile, Idler, PathSegment, Pulley, Sketch } from './model';

function makePulley(
  id: string,
  toothCount: number,
  x: number,
  y: number,
  profile: BeltProfile = 'GT2',
): Pulley {
  return { id, label: id, toothCount, x, y, profile, isOrigin: id === 'P1' };
}

function makeSketch(
  pulleys: Pulley[],
  idlers: Idler[] = [],
  orderedIds = pulleys.map((pulley) => pulley.id),
  overrides: Partial<Sketch> = {},
): Sketch {
  return {
    schemaVersion: 1,
    profile: pulleys[0]?.profile ?? 'GT2',
    pulleys,
    idlers,
    route: [...orderedIds, orderedIds[0]!],
    dimensions: [],
    constraints: [],
    toleranceTeeth: 0.2,
    availableBeltTeeth: [],
    view: { centerX: 0, centerY: 0, zoom: 1 },
    ...overrides,
  };
}

function twoPulleys(
  firstTeeth: number,
  secondTeeth: number,
  distance: number,
  overrides: Partial<Sketch> = {},
): Sketch {
  return makeSketch([
    makePulley('P1', firstTeeth, 0, 0),
    makePulley('P2', secondTeeth, distance, 0),
  ], [], undefined, overrides);
}

function sumLines(result: ReturnType<typeof calculateBeltGeometry>): number {
  return result.segments
    .filter((segment) => segment.kind === 'line')
    .reduce((sum, segment) => sum + segment.lengthMm, 0);
}

function sumArcs(result: ReturnType<typeof calculateBeltGeometry>): number {
  return result.segments
    .filter((segment) => segment.kind === 'arc')
    .reduce((sum, segment) => sum + segment.lengthMm, 0);
}

function lineLengths(result: ReturnType<typeof calculateBeltGeometry>): number[] {
  return result.segments
    .filter((segment) => segment.kind === 'line')
    .map((segment) => segment.lengthMm);
}

function tangentAlignment(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return (first.x * second.x + first.y * second.y)
    / (Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y));
}

function reversed(sketch: Sketch): Sketch {
  const route = sketch.route.slice(0, -1).reverse();
  return { ...sketch, route: [...route, route[0]!] };
}

function segmentStart(segment: PathSegment): { x: number; y: number } {
  if (segment.kind === 'line') return segment.start;
  return {
    x: segment.center.x + segment.radiusMm * Math.cos(segment.startAngle),
    y: segment.center.y + segment.radiusMm * Math.sin(segment.startAngle),
  };
}

function segmentEnd(segment: PathSegment): { x: number; y: number } {
  if (segment.kind === 'line') return segment.end;
  return {
    x: segment.center.x + segment.radiusMm * Math.cos(segment.endAngle),
    y: segment.center.y + segment.radiusMm * Math.sin(segment.endAngle),
  };
}

describe('belt geometry', () => {
  it('pitchDiameterUsesProfilePitch', () => {
    expect(pitchDiameter('GT2', 20)).toBeCloseTo(40 / Math.PI, 12);
    expect(pitchDiameter('GT3', 20)).toBeCloseTo(60 / Math.PI, 12);
    expect(pitchDiameter('HTD 5M', 20)).toBeCloseTo(100 / Math.PI, 12);
  });

  it('equalPulleyRouteHasTwoTangentsAndFullWrap', () => {
    const result = calculateBeltGeometry(twoPulleys(20, 20, 100));
    expect(result.valid).toBe(true);
    expect(sumLines(result)).toBeCloseTo(200, 10);
    expect(sumArcs(result)).toBeCloseTo(40, 10);
    expect(result.lengthMm).toBeCloseTo(240, 10);
  });

  it('unequalPulleyRouteUsesExternalTangents', () => {
    const delta = 20 / Math.PI;
    const result = calculateBeltGeometry(twoPulleys(40, 20, 100));
    const tangentLength = Math.sqrt(10000 - delta ** 2);
    expect(lineLengths(result)).toHaveLength(2);
    expect(lineLengths(result)[0]).toBeCloseTo(tangentLength, 10);
    expect(lineLengths(result)[1]).toBeCloseTo(tangentLength, 10);
    expect(result.lengthMm).toBeCloseTo(
      2 * tangentLength + 60 + 2 * delta * Math.asin(delta / 100),
      10,
    );
  });

  it('routeReversalPreservesLength', () => {
    const sketch = twoPulleys(40, 20, 100);
    expect(calculateBeltGeometry(reversed(sketch)).lengthMm).toBeCloseTo(
      calculateBeltGeometry(sketch).lengthMm!,
      9,
    );
  });

  it.each([3, 4])('multiPulleyRouteConnectsEveryWrap for %i pulleys', (count) => {
    const all = [
      makePulley('P1', 20, 0, 0),
      makePulley('P2', 20, 100, 0),
      makePulley('P3', 20, 50, 86),
      makePulley('P4', 20, 0, 100),
    ];
    const sketch = makeSketch(all.slice(0, count));
    const result = calculateBeltGeometry(sketch);
    expect(result.valid).toBe(true);
    expect(result.segments.filter((segment) => segment.kind === 'line')).toHaveLength(count);
    expect(result.segments.filter((segment) => segment.kind === 'arc')).toHaveLength(count);
    expect(result.lengthMm).toBeCloseTo(sumLines(result) + sumArcs(result), 10);
    expect(result.segments.every((segment) => segment.lengthMm > 0)).toBe(true);
    result.segments.forEach((segment, index) => {
      const end = segmentEnd(segment);
      const start = segmentStart(result.segments[(index + 1) % result.segments.length]!);
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(1e-9);
    });
  });

  it('idlerUsesLowerSmoothContact', () => {
    const idler: Idler = { id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 10.366197723675814 };
    const sketch = makeSketch(
      [makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0)],
      [idler],
      ['P1', 'T1', 'P2'],
    );
    const result = calculateBeltGeometry(sketch);
    const idlerArc = result.segments.find(
      (segment) => segment.kind === 'arc' && segment.componentId === 'T1',
    );
    expect(result.valid).toBe(true);
    expect(idlerArc?.kind).toBe('arc');
    if (idlerArc?.kind === 'arc') {
      expect(idlerArc.contactFace).toBe('smooth');
      const sampledY = Array.from({ length: 21 }, (_, index) => {
        const angle = idlerArc.startAngle + (idlerArc.endAngle - idlerArc.startAngle) * index / 20;
        return idlerArc.center.y + idlerArc.radiusMm * Math.sin(angle);
      });
      expect(Math.min(...sampledY)).toBeLessThan(idler.y - idler.diameterMm * 0.45);
    }
    expect(result.idlerContributions[0]?.lengthMm).toBeGreaterThan(0);
    result.segments.forEach((segment, index) => {
      if (segment.kind !== 'arc') return;
      const incoming = result.segments[(index - 1 + result.segments.length) % result.segments.length]!;
      const outgoing = result.segments[(index + 1) % result.segments.length]!;
      expect(incoming.kind).toBe('line');
      expect(outgoing.kind).toBe('line');
      if (incoming.kind !== 'line' || outgoing.kind !== 'line') return;
      const sweep = Math.sign(segment.endAngle - segment.startAngle);
      const startTangent = { x: -Math.sin(segment.startAngle) * sweep, y: Math.cos(segment.startAngle) * sweep };
      const endTangent = { x: -Math.sin(segment.endAngle) * sweep, y: Math.cos(segment.endAngle) * sweep };
      expect(tangentAlignment(startTangent, {
        x: incoming.end.x - incoming.start.x,
        y: incoming.end.y - incoming.start.y,
      })).toBeGreaterThan(0.999999);
      expect(tangentAlignment(endTangent, {
        x: outgoing.end.x - outgoing.start.x,
        y: outgoing.end.y - outgoing.start.y,
      })).toBeGreaterThan(0.999999);
    });
  });

  it('changingASmoothTensionerDiameterChangesPathAndToothCount', () => {
    const pulleys = [makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0)];
    const route = ['P1', 'T1', 'P2', 'P1'];
    const small = calculateBeltGeometry(makeSketch(pulleys, [
      { id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 10.366197723675814 },
    ], route.slice(0, -1)));
    const large = calculateBeltGeometry(makeSketch(pulleys, [
      { id: 'T1', label: 'T1', diameterMm: 20, x: 50, y: 10.366197723675814 },
    ], route.slice(0, -1)));
    expect(small.valid).toBe(true);
    expect(large.valid).toBe(true);
    expect(Math.abs(large.lengthMm! - small.lengthMm!)).toBeGreaterThan(0.01);
    expect(large.exactTeeth).not.toBe(small.exactTeeth);
  });

  it('overlapReturnsDiagnosticWithoutLength', () => {
    const result = calculateBeltGeometry(twoPulleys(20, 20, 10));
    expect(result.valid).toBe(false);
    expect(result.diagnostic).toContain('overlap');
    expect(result.lengthMm).toBeNull();
    expect(result.exactTeeth).toBeNull();
  });

  it('toothCandidatesRespectTolerance', () => {
    const result = calculateBeltGeometry(
      twoPulleys(20, 20, 154.2, { toleranceTeeth: 0.2, availableBeltTeeth: [171, 178] }),
    );
    expect(result.exactTeeth).toBeCloseTo(174.2, 10);
    expect(result.nearestTeeth).toBe(174);
    expect(result.lowerTeeth).toBe(174);
    expect(result.higherTeeth).toBe(175);
    expect(result.nearestToothError).toBeCloseTo(0.2, 10);
    expect(result.passesTolerance).toBe(true);
    expect(result.bestAvailableTeeth).toBe(171);
    expect(result.bestAvailableLengthErrorMm).toBeCloseTo(6.4, 10);
  });

  it('routeSupportsTwentyObjects', () => {
    const pulleys = Array.from({ length: 20 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 20;
      return makePulley(`P${index + 1}`, 20, 100 * Math.cos(angle), 100 * Math.sin(angle));
    });
    const result = calculateBeltGeometry(makeSketch(pulleys));
    expect(result.valid).toBe(true);
    expect(new Set(result.segments.map((segment) => segment.componentId)).size).toBe(20);
    expect(result.segments.filter((segment) => segment.kind === 'arc')).toHaveLength(20);
    // An equal-radius convex belt is the polygon perimeter plus one full circle.
    expect(result.lengthMm).toBeCloseTo(20 * 200 * Math.sin(Math.PI / 20) + 40, 9);
  });

  it('returns diagnostics for degenerate, stale, crossing, and nonfinite routes', () => {
    const square = makeSketch([
      makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0),
      makePulley('P3', 20, 100, 100), makePulley('P4', 20, 0, 100),
    ]);
    const cases: Sketch[] = [
      { ...square, route: ['P1', 'P3', 'P2', 'P4', 'P1'] },
      { ...square, route: ['P1', 'missing', 'P1'] },
      { ...square, route: ['P1', 'P2', 'P3', 'P2', 'P1'] },
      makeSketch([makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0), makePulley('P3', 20, 200, 0)]),
      twoPulleys(20, 20, Number.NaN),
      twoPulleys(20, Number.POSITIVE_INFINITY, 100),
    ];
    for (const sketch of cases) {
      const result = calculateBeltGeometry(sketch);
      expect(result.valid).toBe(false);
      expect(result.diagnostic).toBeTruthy();
      expect(result.segments).toEqual([]);
      expect(result.lengthMm).toBeNull();
      expect(result.exactTeeth).toBeNull();
    }
  });

  it('keeps nearly touching equal pulleys finite and rejects a zero-length backside tangent', () => {
    const pulleyDiameter = pitchDiameter('GT2', 20);
    const near = calculateBeltGeometry(twoPulleys(20, 20, pulleyDiameter + 1e-8));
    expect(near.valid).toBe(true);
    expect(near.lengthMm).toBeCloseTo(2 * (pulleyDiameter + 1e-8) + 40, 9);
    expect(near.segments.every(segment => Number.isFinite(segment.lengthMm))).toBe(true);

    const touching = makeSketch(
      [makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0)],
      [{ id: 'T1', label: 'T1', diameterMm: 12, x: pulleyDiameter / 2 + 6, y: 0 }],
      ['P1', 'T1', 'P2'],
    );
    expect(calculateBeltGeometry(touching)).toMatchObject({ valid: false, lengthMm: null, exactTeeth: null });
  });

  it('keeps backside contact when an idler reaches the pulley center line', () => {
    const result = calculateBeltGeometry(makeSketch(
      [makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0)],
      [{ id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 0 }],
      ['P1', 'T1', 'P2'],
    ));
    expect(result.valid).toBe(true);
    expect(result.lengthMm).toBeGreaterThan(240);
    const arc = result.segments.find(s => s.kind === 'arc' && s.componentId === 'T1');
    if (arc?.kind !== 'arc') throw new Error('No idler contact arc');
    const middle = (arc.startAngle + arc.endAngle) / 2;
    expect(arc.center.y + arc.radiusMm * Math.sin(middle)).toBeCloseTo(-6, 9);
    expect(arc.endAngle).toBeGreaterThan(arc.startAngle);
  });

  it('rejects the self crossing loop from an idler clear of the belt', () => {
    const result = calculateBeltGeometry(makeSketch(
      [makePulley('P1', 20, 0, 0), makePulley('P2', 20, 100, 0)],
      [{ id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 25 }],
      ['P1', 'T1', 'P2'],
    ));
    expect(result.valid).toBe(false);
    expect(result.lengthMm).toBeNull();
  });

  it.each(['GT2', 'GT3', 'HTD 5M'] as const)('rounds half teeth up and tests the tolerance boundary for %s', profile => {
    const pitch = profile === 'GT2' ? 2 : profile === 'GT3' ? 3 : 5;
    const half = calculateBeltGeometry(makeSketch([
      makePulley('P1', 20, 0, 0, profile), makePulley('P2', 20, 77.25 * pitch, 0, profile),
    ]));
    expect(half.exactTeeth).toBeCloseTo(174.5, 9);
    expect(half.nearestTeeth).toBe(175);
    expect(half.nearestToothError).toBeCloseTo(-0.5, 9);
    expect(half.passesTolerance).toBe(false);
  });
});
