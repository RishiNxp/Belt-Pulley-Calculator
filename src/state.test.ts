import { describe, expect, it } from 'vitest';
import { reduceSketch } from './state';
import { calculateBeltGeometry } from './geometry';
import type { HistoryState, Pulley, Sketch } from './model';

function makePulley(id: string, x: number, y: number, isOrigin = false): Pulley {
  return { id, label: id, toothCount: 20, profile: 'GT2', x, y, isOrigin };
}

function makeSketch(pulleys: Pulley[]): Sketch {
  return {
    schemaVersion: 1,
    profile: 'GT2',
    pulleys,
    idlers: [],
    route: [],
    dimensions: [],
    constraints: [],
    toleranceTeeth: 0.2,
    availableBeltTeeth: [],
    view: { centerX: 0, centerY: 0, zoom: 1 },
  };
}

function history(present: Sketch): HistoryState {
  return { past: [], present, future: [], activeEdit: null };
}

function sampleSketch(): Sketch {
  return makeSketch([makePulley('P1', 0, 0, true), makePulley('P2', 10, 20), makePulley('P3', 50, 60)]);
}

describe('sketch state', () => {
  it('firstPulleyIsOrigin', () => {
    const next = reduceSketch(history(makeSketch([])), {
      type: 'ADD_PULLEY',
      pulley: makePulley('P1', 44, 55),
    });
    expect(next.present.pulleys[0]).toMatchObject({ id: 'P1', x: 0, y: 0, isOrigin: true });
  });

  it('dimensionsApplySignedValues', () => {
    let state = history(sampleSketch());
    state = reduceSketch(state, {
      type: 'ADD_DIMENSION',
      dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'horizontal', valueMm: -25, offsetMm: 0 },
    });
    expect(state.present.pulleys[1]).toMatchObject({ x: -25, y: 20 });
    state = reduceSketch(state, { type: 'SET_DIMENSION_VALUE', id: 'D1', valueMm: 117 });
    expect(state.present.pulleys[1]).toMatchObject({ x: 117, y: 20 });

    state = reduceSketch(state, {
      type: 'ADD_DIMENSION',
      dimension: { id: 'D2', fromId: 'P1', toId: 'P2', kind: 'vertical', valueMm: 42, offsetMm: 0 },
    });
    expect(state.present.pulleys[1]).toMatchObject({ x: 117, y: 42 });

    const beforeConflictingDimension = state.present;
    state = reduceSketch(state, {
      type: 'ADD_DIMENSION',
      dimension: { id: 'D3', fromId: 'P1', toId: 'P2', kind: 'aligned', valueMm: 130, offsetMm: 0 },
    });
    // X=117 and Y=42 already fix the distance; accepting 130 would falsify those labels.
    expect(state.present).toEqual(beforeConflictingDimension);
    expect(state.present.dimensions).toHaveLength(2);
  });

  it('alignmentKeepsPairCoordinatesEqual', () => {
    let state = history(sampleSketch());
    state = reduceSketch(state, {
      type: 'ADD_CONSTRAINT',
      constraint: { id: 'C1', firstId: 'P1', secondId: 'P2', kind: 'horizontal' },
    });
    expect(state.present.pulleys[1]).toMatchObject({ x: 10, y: 0 });
    state = reduceSketch(state, {
      type: 'ADD_CONSTRAINT',
      constraint: { id: 'C2', firstId: 'P1', secondId: 'P3', kind: 'vertical' },
    });
    expect(state.present.pulleys[2]).toMatchObject({ x: 0, y: 60 });

    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 27, y: 75 });
    expect(state.present.pulleys[1]).toMatchObject({ x: 27, y: 0 });
  });

  it('selectingRouteStartClosesRoute', () => {
    let state = history(sampleSketch());
    for (const objectId of ['P1', 'P2', 'P3', 'P1']) {
      state = reduceSketch(state, { type: 'ROUTE_CLICK', objectId });
    }
    expect(state.present.route).toEqual(['P1', 'P2', 'P3', 'P1']);
  });

  it('deleteUndoRedoRoundTrips', () => {
    const initial = sampleSketch();
    let state = reduceSketch(history(initial), { type: 'DELETE_OBJECT', id: 'P2' });
    expect(state.present.pulleys.map((pulley) => pulley.id)).toEqual(['P1', 'P3']);
    state = reduceSketch(state, { type: 'UNDO' });
    expect(state.present).toEqual(initial);
    state = reduceSketch(state, { type: 'REDO' });
    expect(state.present.pulleys.map((pulley) => pulley.id)).toEqual(['P1', 'P3']);
  });

  it('deletingAnIntermediatePulleyRepairsAClosedRoute', () => {
    const sketch = {
      ...makeSketch([
        makePulley('P1', 0, 0, true),
        makePulley('P2', 100, 0),
        makePulley('P3', 100, 80),
        makePulley('P4', 0, 80),
      ]),
      route: ['P1', 'P2', 'P3', 'P4', 'P1'],
      idlers: [{ id: 'T1', label: 'T1', diameterMm: 12, x: 70, y: 90 }],
      dimensions: [{ id: 'D1', fromId: 'P2', toId: 'P3', kind: 'aligned' as const, valueMm: 80, offsetMm: 10 }],
      constraints: [{ id: 'C1', firstId: 'P3', secondId: 'T1', kind: 'horizontal' as const }],
    };
    const state = reduceSketch(history(sketch), { type: 'DELETE_OBJECT', id: 'P3' });
    expect(state.present.route).toEqual(['P1', 'P2', 'P4', 'P1']);
    expect(calculateBeltGeometry(state.present).valid).toBe(true);
    expect(state.present.dimensions).toEqual([]);
    expect(state.present.constraints).toEqual([]);
    expect(state.present.idlers).toHaveLength(1);
  });

  it('insertsANewTensionerIntoTheClickedClosedRouteSegment', () => {
    const sketch = {
      ...makeSketch([makePulley('P1', 0, 0, true), makePulley('P2', 100, 0), makePulley('P3', 100, 80)]),
      route: ['P1', 'P2', 'P3', 'P1'],
    };
    const state = reduceSketch(history(sketch), {
      type: 'ADD_IDLER',
      idler: { id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 20 },
      segment: { fromId: 'P2', toId: 'P3' },
    });
    expect(state.present.route).toEqual(['P1', 'P2', 'T1', 'P3', 'P1']);
    expect(state.present.idlers).toContainEqual({ id: 'T1', label: 'T1', diameterMm: 12, x: 50, y: 20 });
  });

  it('keepsTheOriginFixedWhenEditingACenterDistanceToIt', () => {
    let state = history(sampleSketch());
    state = reduceSketch(state, {
      type: 'ADD_DIMENSION',
      dimension: { id: 'D1', fromId: 'P2', toId: 'P1', kind: 'aligned', valueMm: 40, offsetMm: 18 },
    });
    expect(state.present.pulleys[0]).toMatchObject({ x: 0, y: 0, isOrigin: true });
    expect(Math.hypot(state.present.pulleys[1]!.x, state.present.pulleys[1]!.y)).toBeCloseTo(40, 10);
  });

  it('drivingDimensionsStayExactWhenTheirPulleyIsMoved', () => {
    let state = reduceSketch(history(sampleSketch()), {
      type: 'ADD_DIMENSION',
      dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'aligned', valueMm: 100, offsetMm: 18 },
    });
    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 140, y: 0 });
    expect(Math.hypot(state.present.pulleys[1]!.x, state.present.pulleys[1]!.y)).toBeCloseTo(100, 10);
    expect(state.present.dimensions[0]!.valueMm).toBe(100);
  });

  it('aDragUndoRestoresStartingCoordinates', () => {
    let state = history(sampleSketch());
    state = reduceSketch(state, { type: 'BEGIN_DRAG', id: 'P2' });
    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 30, y: 31 });
    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 70, y: 81 });
    state = reduceSketch(state, { type: 'END_DRAG' });
    expect(state.present.pulleys[1]).toMatchObject({ x: 70, y: 81 });
    state = reduceSketch(state, { type: 'UNDO' });
    expect(state.present.pulleys[1]).toMatchObject({ x: 10, y: 20 });
  });

  it('addingAComponentCanBeUndoneAndRedone', () => {
    const initial = sampleSketch();
    let state = reduceSketch(history(initial), {
      type: 'ADD_IDLER',
      idler: { id: 'T1', label: 'T1', diameterMm: 30, x: 40, y: -15 },
    });
    expect(state.present.idlers).toHaveLength(1);

    state = reduceSketch(state, { type: 'UNDO' });
    expect(state.present).toEqual(initial);

    state = reduceSketch(state, { type: 'REDO' });
    expect(state.present.idlers).toHaveLength(1);
  });

  it('finishesDragBeforeRecordingAnotherChange', () => {
    const initial = sampleSketch();
    let state = reduceSketch(history(initial), { type: 'BEGIN_DRAG', id: 'P2' });
    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 30, y: 31 });
    state = reduceSketch(state, {
      type: 'ADD_IDLER',
      idler: { id: 'T1', label: 'T1', diameterMm: 30, x: 40, y: -15 },
    });

    expect(state.activeEdit).toBeNull();
    expect(state.past).toHaveLength(2);
    expect(state.present.pulleys[1]).toMatchObject({ x: 30, y: 31 });
    expect(state.present.idlers).toHaveLength(1);

    state = reduceSketch(state, { type: 'UNDO' });
    expect(state.present.pulleys[1]).toMatchObject({ x: 30, y: 31 });
    expect(state.present.idlers).toHaveLength(0);
    state = reduceSketch(state, { type: 'UNDO' });
    expect(state.present).toEqual(initial);
  });

  it('ignoresNonFiniteObjectMoves', () => {
    const initial = sampleSketch();
    const state = history(initial);
    expect(reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: Number.NaN, y: 20 })).toBe(state);
    expect(reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 10, y: Number.POSITIVE_INFINITY })).toBe(state);
  });

  it('does not create an orphan idler for a stale clicked segment', () => {
    const sketch = { ...sampleSketch(), route: ['P1', 'P2', 'P3', 'P1'] };
    const next = reduceSketch(history(sketch), {
      type: 'ADD_IDLER', idler: { id: 'T1', label: 'T1', diameterMm: 12, x: 30, y: 10 },
      segment: { fromId: 'P1', toId: 'P3' },
    });
    expect(next.present.idlers).toEqual([]);
    expect(next.present.route).toEqual(sketch.route);
  });

  it('keeps transitive horizontal constraints tied to the fixed origin while dragging', () => {
    let state = history(sampleSketch());
    state = reduceSketch(state, { type: 'ADD_CONSTRAINT', constraint: { id: 'C1', firstId: 'P1', secondId: 'P2', kind: 'horizontal' } });
    state = reduceSketch(state, { type: 'ADD_CONSTRAINT', constraint: { id: 'C2', firstId: 'P2', secondId: 'P3', kind: 'horizontal' } });
    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P3', x: -100, y: -50 });
    expect(state.present.pulleys.map(p => p.y)).toEqual([0, 0, 0]);
    expect(state.present.pulleys[2]!.x).toBe(-100);
  });

  it('honors an aligned distance when adding a horizontal constraint', () => {
    let state = history(makeSketch([makePulley('P1', 0, 0, true), makePulley('P2', 60, 80)]));
    state = reduceSketch(state, { type: 'ADD_DIMENSION', dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'aligned', valueMm: 100, offsetMm: 18 } });
    state = reduceSketch(state, { type: 'ADD_CONSTRAINT', constraint: { id: 'C1', firstId: 'P1', secondId: 'P2', kind: 'horizontal' } });
    expect(state.present.pulleys[1]).toMatchObject({ x: 100, y: 0 });
  });

  it('edits a center distance exactly using the free axis when a horizontal dimension fixes X', () => {
    let state = history(makeSketch([makePulley('P1', 0, 0, true), makePulley('P2', 100, 50)]));
    state = reduceSketch(state, { type: 'ADD_DIMENSION', dimension: { id: 'DX', fromId: 'P1', toId: 'P2', kind: 'horizontal', valueMm: 100, offsetMm: 18 } });
    state = reduceSketch(state, { type: 'ADD_DIMENSION', dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'aligned', valueMm: Math.hypot(100, 50), offsetMm: 18 } });
    state = reduceSketch(state, { type: 'SET_DIMENSION_VALUE', id: 'D1', valueMm: 150 });
    const point = state.present.pulleys[1]!;
    expect(point.x).toBe(100);
    expect(point.y).toBeCloseTo(111.80339887498948, 9);
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(150, 9);
  });

  it('rejects contradictory relationships instead of leaving stale dimension values', () => {
    let state = reduceSketch(history(sampleSketch()), { type: 'ADD_DIMENSION', dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'horizontal', valueMm: 25, offsetMm: 18 } });
    const before = state.present;
    state = reduceSketch(state, { type: 'ADD_CONSTRAINT', constraint: { id: 'C1', firstId: 'P1', secondId: 'P2', kind: 'vertical' } });
    expect(state.present).toEqual(before);
  });

  it('preserves relative positions when deleting and replacing the origin', () => {
    const sketch = makeSketch([makePulley('P1', 0, 0, true), makePulley('P2', 100, 50), makePulley('P3', -100, -50)]);
    const state = reduceSketch(history(sketch), { type: 'DELETE_OBJECT', id: 'P1' });
    expect(state.present.pulleys[0]).toMatchObject({ x: 0, y: 0, isOrigin: true });
    expect(state.present.pulleys[1]).toMatchObject({ x: -200, y: -100 });
  });

  it('rejects fractional tooth counts and nonpositive idler diameters at the state boundary', () => {
    const sketch = { ...sampleSketch(), idlers: [{ id: 'T1', label: 'T1', diameterMm: 12, x: 100, y: 100 }] };
    const state = history(sketch);
    expect(reduceSketch(state, { type: 'UPDATE_PULLEY', id: 'P2', changes: { toothCount: 20.5 } }).present.pulleys[1]!.toothCount).toBe(20);
    expect(reduceSketch(state, { type: 'UPDATE_IDLER', id: 'T1', changes: { diameterMm: -1 } }).present.idlers[0]!.diameterMm).toBe(12);
  });

  it('edits an unconstrained center distance to 120 and then 150 without moving the origin', () => {
    let state = history(sampleSketch());
    state = reduceSketch(state, { type: 'ADD_DIMENSION', dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'aligned', valueMm: 120, offsetMm: 18 } });
    expect(Math.hypot(state.present.pulleys[1]!.x, state.present.pulleys[1]!.y)).toBeCloseTo(120, 9);
    state = reduceSketch(state, { type: 'SET_DIMENSION_VALUE', id: 'D1', valueMm: 150 });
    expect(Math.hypot(state.present.pulleys[1]!.x, state.present.pulleys[1]!.y)).toBeCloseTo(150, 9);
    expect(state.present.pulleys[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('deletes only the selected dimension and leaves the belt and pulleys intact', () => {
    const sketch = { ...sampleSketch(), route: ['P1', 'P2', 'P3', 'P1'] };
    let state = reduceSketch(history(sketch), { type: 'ADD_DIMENSION', dimension: { id: 'D1', fromId: 'P1', toId: 'P2', kind: 'aligned', valueMm: Math.hypot(10, 20), offsetMm: 18 } });
    const pulleys = state.present.pulleys;
    state = reduceSketch(state, { type: 'REMOVE_DIMENSION', id: 'D1' });
    expect(state.present.dimensions).toEqual([]);
    expect(state.present.pulleys).toEqual(pulleys);
    expect(state.present.route).toEqual(sketch.route);
  });

  it('clears an intentionally deleted belt without deleting its objects', () => {
    const sketch = { ...sampleSketch(), route: ['P1', 'P2', 'P3', 'P1'] };
    const state = reduceSketch(history(sketch), { type: 'CLEAR_ROUTE' });
    expect(state.present?.route).toEqual([]);
    expect(state.present?.pulleys).toEqual(sketch.pulleys);
  });

  it('allows rebuilding a closed route beginning at its original origin pulley', () => {
    const sketch = { ...sampleSketch(), route: ['P1', 'P2', 'P3', 'P1'] };
    const state = reduceSketch(history(sketch), { type: 'ROUTE_CLICK', objectId: 'P1' });
    expect(state.present.route).toEqual(['P1']);
  });

  it('stores drive choices and removes a deleted output reference', () => {
    let state = history({ ...sampleSketch(), route: ['P1', 'P2', 'P3', 'P1'] });
    state = reduceSketch(state, { type: 'SET_DRIVE', changes: { driverId: 'P1', outputId: 'P3', driverRpm: 3000 } });
    expect(state.present?.drive).toEqual({ driverId: 'P1', outputId: 'P3', driverRpm: 3000 });
    state = reduceSketch(state, { type: 'DELETE_OBJECT', id: 'P3' });
    expect(state.present.drive?.outputId).toBeNull();
  });

  it('does not add an undo step when a driving dimension prevents a coordinate change', () => {
    let state = reduceSketch(history(sampleSketch()), {
      type: 'ADD_DIMENSION',
      dimension: { id: 'DX', fromId: 'P1', toId: 'P2', kind: 'horizontal', valueMm: 10, offsetMm: 18 },
    });
    const before = state;
    state = reduceSketch(state, { type: 'MOVE_OBJECT', id: 'P2', x: 100, y: 20 });
    expect(state).toBe(before);
    expect(state.past).toHaveLength(1);
  });
});
