# Belt Pulley Calculator — bug review

2026-10-05. One implementation and review pass on the existing application. The sketch workspace and existing saved geometry were preserved. Browser verification used the user's two-pulley sketch; temporary edits were undone afterward.

## Critical

| Problem | Cause | Fix | Verification |
| --- | --- | --- | --- |
| Moving a backside idler could reverse belt winding; a valid two-pulley route with an idler on the center line was rejected. | Winding and collinearity were calculated from all route centers, including the idler. | Determine winding from toothed pulleys; keep smooth contact arcs opposite their winding. | Tests check center-line idler contact, positive length contribution, and tangent continuity at every contact arc. |
| An idler clear of the belt could produce an accepted self-crossing loop and incorrect length. | Intersection checks skipped adjacent tangent sections. | Check every tangent pair, including collinear contact, and check intervening circles. Invalid routes return a diagnostic without a length. | Reproduced crossing loop now rejected; crossing, overlap, degenerate, missing-reference, and nonfinite cases checked. |
| Dimensions and chained constraints could disagree with actual geometry. | Sequential position updates could undo earlier constraints or leave dimension labels unsatisfied. | Resolve signed axis relations as connected groups anchored to the origin, then solve aligned distances through free axes. Reject conflicting edits atomically with a visible notice. | Tests cover transitive origin constraints, aligned distance plus horizontal alignment, fixed-X/free-Y edits, and contradiction rejection. Browser center distances measured exactly 120 and 150 mm. |
| Deleting the origin changed the remaining layout. | Only the replacement origin was moved to zero. | Translate all remaining objects and the camera together; clean dependent relationships. | Origin replacement test preserves relative positions, including negative coordinates. |

## Major

| Problem | Cause | Fix | Verification |
| --- | --- | --- | --- |
| Add Tensioner could ignore clicks near a pulley or create an unusable layout on a short span. | Pulley hit areas intercepted belt clicks; the default placement did not ensure clearance. | Resolve the active tool in SVG capture, find the canonical straight span within a 12 px target, and choose a validated position/diameter. Prefer 30 mm; reduce only for insufficient clearance. | Browser insertion near a pulley after pan/zoom produced `P1 → T7 → P5`, changed length from 469.46 to 469.90 mm, then dragging changed it to 470.49 mm. Short-span and closing-edge tests pass. |
| A stale segment could leave an orphan tensioner. | Circle creation was not conditional on successful route insertion. | Carry explicit `fromId`/`toId` on each line and insert only into that exact consecutive edge. | Stale-edge test leaves both objects and route unchanged. Multiple-idler test preserves closing-edge identity. |
| Dimension selection was hard to target and see. | Thin targets, lower rendering order, and incomplete selection styling. | Draw dimensions above object hits; use a 14 px invisible line target and a label box; highlight lines, arrows, extensions, and text in red. Select on pointer down. | Browser checked selected styles, Escape deselection, double-click editing, and Delete removal while both pulleys and the belt remained. |
| Belt keyboard deletion did nothing, and constraint glyphs were not selectable. | Belt selection was excluded from deletion; glyphs had no selection handler. | Handle belt deletion explicitly and give constraints selectable targets. Keep all entity deletion routed through one selected ID. | Belt-only deletion and dependent-reference tests pass; dimension Delete and tensioner Backspace verified in the browser. Constraint handlers and keyboard priority reviewed. |
| Reset View could render with an old camera; Fit View clipped dimensions. | Camera ref updated after render; fitted bounds included only circles. | Synchronize the camera during render and include dimension endpoints in fitted bounds. | Browser Reset immediately centered the origin; Fit brought the existing clipped dimension into view. |
| Selecting or dragging a pulley could jump its center to the pointer. | Dragging used the pointer as the center immediately. | Preserve the initial pointer offset and require 3 px movement before beginning a drag. | Browser selections left geometry unchanged; tensioner drag moved by the expected transformed pointer delta. Drag Undo test restores starting coordinates. |
| Coordinate fields could display values that the solver did not commit. | The input stored the parsed draft even when the committed prop stayed unchanged. | Restore the committed value after blur, then update from actual props; reset property drafts when selection changes. | Browser entered X=100 for a pulley held at X=40.144512 by a dimension: geometry stayed fixed and the field now shows 40.144512. |

## Minor

| Problem | Cause | Fix | Verification |
| --- | --- | --- | --- |
| Signed calculation errors used inconsistent conventions. | Geometry returned nominal-minus-path while the UI negated selected values. | Use `exact − whole` and `path − nominal` consistently, including available-belt length error; label the convention. | Tests verify signs, half-tooth rounding, GT2/GT3/HTD 5M pitches, and tolerance boundaries. |
| Unchanged constrained edits added empty Undo steps. | A newly allocated sketch was recorded even when its contents were identical. | Skip unchanged state before recording history. | Regression failed before the fix and passes afterward; one real dimension edit remains one Undo step. |
| Fractional teeth and invalid diameters could enter state; property input could silently round teeth. | Validation was incomplete at the input/reducer boundary. | Require positive integer teeth, finite positions, positive finite diameters, and finite camera/RPM values. | Invalid-input state and drive tests pass; UI retains the last committed invalid-entry value. |
| Browser storage write failure escaped the save callback. | Persistence wrote without catching quota/access errors. | Catch write failures so the in-memory sketch stays usable; migrate missing optional drive preferences. | Throwing-storage and legacy-sketch tests pass without losing geometry. |
| Space-pan could remain active after losing window focus. | The key release could occur outside the window. | Clear Space and active pointer state on blur; clean up all listeners. | Blur, pointer-capture, and listener lifecycle paths inspected. |
| A selected dimension had a large white browser focus rectangle. | SVG group focus outlined the entire dimension bounds. | Suppress that outline only when the entity is selected; its red geometry remains the focus indication. | Final browser screenshot checked; unselected keyboard focus styling is retained. |

## Review checklist

| System | Reviewed and checked |
| --- | --- |
| A — Coordinates | Central `worldToScreen`/`screenToWorld`; `(100,50)` right/up and `(-100,-50)` left/down; inverse conversion, pointer-anchored zoom, pan, snapping, grid, axes, dimension and idler hits. |
| B — Pulley state | Origin locking/replacement, add/move/delete, integer teeth, profile synchronization, selection cleanup, finite-value guards. |
| C — Routing | 2/3/4/20-pulley routes, closing/rebuilding, exact edge insertion, removal repair, stale IDs, overlap and self-intersection rejection. |
| D — Tangents | Independent equal/unequal-pulley length formulas, tangent/arc direction continuity, smooth backside contact, nearly touching circles, impossible tangents, clamped square roots, nonfinite inputs. |
| E/F — Length and teeth | Render and length use the same ordered line/arc segments; segment sums match totals; an independent 20-pulley perimeter formula matches; pitches 2/3/5 mm, rounding and tolerance signs verified. |
| G — Tensioners | Clicked-edge assignment, moving, 20/40 mm diameter edits, smooth contact, multiple idlers, collisions/invalid loops, deletion restoring original route and length. |
| H/I — Dimensions and constraints | Immediate selection, red highlight, larger hits, inline edit, Escape/Delete, fixed-origin combinations, signed coordinates, dependent cleanup, bounded conflict handling. |
| J/K — Selection and deletion | Pulley/idler/belt/dimension/constraint priority, tool capture, dimension labels above pulley hits, editable-field keyboard exclusions, entity-specific removal. |
| L — React/state | Immutable reducers, camera refs, pending-ID cleanup, derived geometry/ratios, drag history, listener/effect cleanup, persistence and legacy optional fields. No unbounded solver/update loop. |

## Required scenario results

- Coordinates: automated screen positions and pan/inverse checks pass; visible positive-Y pulley appears above the origin.
- Dimensions: browser selection/red highlight/Escape/Delete pass; measured center distances are exactly 120.00 then 150.00 mm.
- Tensioner: browser route insertion, live path/teeth changes, diameter changes, and Backspace restoration pass; deletion restores 469.46 mm and 93.893 teeth with no idler references.
- Drive: browser 20T → 60T at 3000 RPM shows 3.000:1, 0.333× speed, 3.000× ideal torque, and 1000 RPM. Blank RPM retains ratios. Automated 20/40/60T speeds are 1/.5/1⁄3; idlers/disconnected pulleys are excluded.
- Pulley deletion: automated `P1 → P2 → P3 → P4 → P1` becomes `P1 → P2 → P4 → P1`; repaired geometry remains valid.

Final verification: **62 tests across 6 files pass**, and the production build passes. Browser verification recorded no console warnings/errors.

## Deliberate limits

Impossible routes show a diagnostic instead of invented belt lengths. Rotation is displayed only for a valid route without backside idlers. Ratios are ideal tooth-count relationships; torque ignores losses. The bounded relation solver rejects unresolved conflicts rather than committing contradictory geometry.
