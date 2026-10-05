# Belt Pulley Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved CAD-style belt and pulley layout calculator.

**Architecture:** Keep a pure TypeScript geometry engine and sketch reducer behind a React/SVG workspace. Panels edit the same sketch state; one calculated path supplies both SVG rendering and belt results.

**Tech Stack:** React, TypeScript, Vite, SVG, Vitest.

**Spec:** [2026-10-05-belt-pulley-calculator-design.md](../specs/2026-10-05-belt-pulley-calculator-design.md)

## Global Constraints

- GT2, GT3, and HTD 5M pitches: 2, 3, and 5 mm.
- Pitch diameter: `teeth × pitch / π`.
- Work in millimeters and radians internally; format only in the UI.
- Default belt tolerance: ±0.20 tooth.
- Route supports at least 20 objects and requires two toothed pulleys.
- The rendered path and reported length use the same line and arc geometry.
- Invalid layouts show a diagnostic without a numeric result.
- Use the approved dark charcoal and red visual language.

## Review Focus

- Intersecting circles or impossible tangent branches: reject cleanly without NaN/Infinity (Task 1).
- Unequal radii and route reversal: preserve tangent lengths and path length within floating-point tolerance (Task 1).
- Three/four pulleys and a lower-side idler wrap: include every route member and arc (Task 1).
- Dimension edits, drag, undo/redo: preserve origin and exact constrained coordinates (Task 2).
- Malformed JSON and incompatible profiles: reject import/route with a useful message (Task 4).

---

### Task 1: App foundation and belt geometry

**Files:** `package.json`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `src/main.tsx`, `src/model.ts`, `src/geometry.ts`, `src/geometry.test.ts`

**Interfaces:** `model.ts` defines `Sketch`, `Pulley`, `Idler`, ordered `RouteEntry` items, a `LineSegment` with start/end points, and an `ArcSegment` with center, radius, unwrapped start/end angles, component ID, and contact face (`teeth` or `smooth`). `BeltGeometryResult` contains the connected segments, validity/diagnostic, length, wrap angles, idler contributions, exact teeth, and nearest/lower/higher whole-tooth results. Export `pitchDiameter(profile, teeth): number` and `calculateBeltGeometry(sketch): BeltGeometryResult` from `geometry.ts`.

- [x] Set up React/TypeScript/Vite and Vitest scripts.
- [x] Write failing tests named `pitchDiameterUsesProfilePitch`, `equalPulleyRouteHasTwoTangentsAndFullWrap`, `unequalPulleyRouteUsesExternalTangents`, `routeReversalPreservesLength`, `multiPulleyRouteConnectsEveryWrap`, `idlerUsesLowerSmoothContact`, `overlapReturnsDiagnosticWithoutLength`, `toothCandidatesRespectTolerance`, and `routeSupportsTwentyObjects`. Pin their assertions with these cases:

```ts
expect(pitchDiameter('GT3', 20)).toBeCloseTo(60 / Math.PI, 12);
const equal = calculateBeltGeometry(twoPulleys(20, 20, 100)); // GT2
expect(sumLines(equal)).toBeCloseTo(200, 10);
expect(sumArcs(equal)).toBeCloseTo(40, 10);
expect(equal.lengthMm).toBeCloseTo(240, 10);
const delta = 20 / Math.PI;
const unequal = calculateBeltGeometry(twoPulleys(40, 20, 100));
expect(lineLengths(unequal)[0]).toBeCloseTo(Math.sqrt(10000 - delta ** 2), 10);
expect(lineLengths(unequal)[1]).toBeCloseTo(Math.sqrt(10000 - delta ** 2), 10);
expect(unequal.lengthMm).toBeCloseTo(2 * Math.sqrt(10000 - delta ** 2) + 60 + 2 * delta * Math.asin(delta / 100), 10);
expect(reverse(unequal).lengthMm).toBeCloseTo(unequal.lengthMm, 9);
```

  Also assert 3/4-route connectivity, lower-side smooth idler contact, overlap/invalid diagnostics with `lengthMm === null`, nearest/lower/higher teeth and signed errors at the ±0.20 T boundary, and every ID in a 20-object route.
- [x] Run `npm.cmd run test -- src/geometry.test.ts`; confirm failures come from missing geometry behavior.
- [x] Implement the pure tangent-and-arc solver; return the actual ordered segments, wrap angles, length contributions, total length, teeth, nearest/lower/higher belts, and validation diagnostic.
- [x] Re-run the focused tests and then `npm.cmd run test`.

### Task 2: Sketch state and deterministic editing

**Files:** `src/state.ts`, `src/state.test.ts`, `src/demo.ts`

**Interfaces:** `HistoryState` is `{ past: Sketch[]; present: Sketch; future: Sketch[] }`. `reduceSketch(state: HistoryState, action: SketchAction): HistoryState`; actions cover add/remove/drag, property edits, route, dimensions, constraints, new design, undo, and redo. `demo.ts` exports the GT2 four-pulley starter sketch and closed demo route.

- [x] Write failing reducer tests `firstPulleyIsOrigin`, `dimensionsApplySignedValues`, `alignmentKeepsPairCoordinatesEqual`, `selectingRouteStartClosesRoute`, and `deleteUndoRedoRoundTrips`. Assert the exact coordinate pairs after each dimension/constraint edit, route contains the start once at both ends, and undo/redo restores deep equality with the before/after `present` sketch.
- [x] Run `npm.cmd run test -- src/state.test.ts` to confirm the reducer behaviors are missing.
- [x] Implement small deterministic state transitions; enforce profile consistency and retain P1 at the origin unless the origin is explicitly changed.
- [x] Re-run reducer and geometry tests.

### Task 3: SVG sketch workspace

**Files:** `src/components/SketchCanvas.tsx`, `src/viewport.ts`, `src/viewport.test.ts`

**Interfaces:** `SketchCanvas` receives sketch, geometry result, selection, active tool, and typed callbacks. `viewport.ts` exports world/screen coordinate transforms and fit-to-bounds calculations.

- [x] Write failing tests `viewportRoundTripsWorldCoordinates` and `fitIncludesAllObjectBounds`; assert coordinate error `< 1e-9` and every fitted object center plus radius lies inside the padded viewport.
- [x] Implement SVG grid/axes/origin, pulley and idler circles, shared belt segments, dimensions, constraints, labels, and invalid-geometry feedback.
- [x] Add click selection, route ordering, placement, drag, wheel zoom, space/middle-button pan, fit/reset, and dimension-value editing. Keep drag updates direct and localized.
- [x] Verify the workspace at the default and compact 800-pixel widths; labels and controls remain inside the visible layout.

### Task 4: Controls, results, and persistence

**Files:** `src/App.tsx`, `src/components/Toolbar.tsx`, `src/components/FeatureTree.tsx`, `src/components/PropertiesPanel.tsx`, `src/components/BeltPanel.tsx`, `src/persistence.ts`, `src/persistence.test.ts`, `src/styles.css`

**Interfaces:** `loadSketch(storage): Sketch`, `saveSketch(storage, sketch): void`, `parseSketchJson(text): Sketch`. Components dispatch `SketchAction` and receive derived geometry rather than duplicating calculations.

- [x] Write failing tests `sketchPersistenceRoundTrips` (saved state equals loaded state) and `importRejectsMalformedOrUnsupportedSketch` (invalid JSON/schema produces a useful error, never a partial sketch).
- [x] Implement tool actions, profile/tooth/coordinate/diameter editing, constraints/dimensions, route and tensioner controls, feature tree selection, calculation panel, tolerance, available belt comparison, New Sketch, local storage, JSON import/export.
- [x] Add responsive dark CAD styling, tooltips, keyboard shortcuts, and undo/redo bindings.
- [x] Run `npm.cmd run test` and `npm.cmd run build`.

### Task 5: Final verification

**Files:** no new files required.

- [x] Start the app with `npm.cmd run dev -- --host 127.0.0.1` and inspect the running UI at default and compact widths.
- [x] Walk core acceptance checks: edit dimensions and constraints, define a route, inspect tangent/arc rendering and live belt values, move a lower-side idler, reload the design, and confirm the browser console has no errors. JSON round-trip and malformed-import checks pass in persistence tests; the browser download/file-chooser path was not manually exercised.
- [x] Fix observed reducer, numeric input, label, and compact-layout defects, then run the full tests and production build once more.
