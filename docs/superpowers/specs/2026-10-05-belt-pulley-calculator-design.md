# Belt Pulley Calculator Design

**Date:** 2026-10-05

## Goal

Build a desktop-first, usable CAD-style web application for laying out a multi-pulley belt route and calculating the matching belt length and tooth count. Geometry correctness and responsive sketch editing take priority over decorative polish.

## User-approved direction

Use React, TypeScript, Vite, and SVG. Keep the engineering geometry independent of React. A single geometry result must drive both the belt drawing and its reported length so the visualization cannot silently disagree with the calculator.

## Structure

- **Geometry engine:** belt pitch and pitch diameter, circle tangents, pulley contact arcs, path length, tooth rounding, and validity diagnostics. Work in millimeters and radians internally; format values only at the UI boundary.
- **Sketch model:** pulleys, smooth idlers, route order, dimensions, alignment constraints, selection, and view state. A small reducer/history layer keeps editing deterministic and supports undo/redo.
- **SVG workspace:** grid and axes, origin, geometry, labels, dimensions, constraints, hit targets, drag, zoom, pan, and fit-to-view. Draw the same line and arc primitives the geometry engine measures.
- **Panels:** compact toolbars, feature tree, selection properties, and live belt results. Resize the workspace with the surrounding layout.

## Engineering behavior

GT2, GT3, and HTD 5M use pitches of 2, 3, and 5 mm. Pulley pitch diameter is `teeth × pitch / π`. The first pulley is created at (0, 0) and is marked as the origin. A closed route is defined by clicking its pulleys in order; it must contain at least two distinct toothed pulleys and return to its start. All toothed pulleys on a route use one compatible profile.

The route solver computes tangent contact points and contact arcs for each ordered circle, including contact with the lower side of each smooth idler in the workspace so the belt passes underneath it with its smooth back against the idler. It returns the ordered segments, wrap angles, each idler's length contribution, and total path length. Length divided by pitch gives exact teeth; the results panel shows the nearest whole tooth, lower/higher alternatives, dimensional and tooth error, and configurable tolerance (default ±0.20 tooth). Invalid or ambiguous layouts report a concise diagnostic and do not present a plausible-looking but false result. Pulley/idler overlap and missing or incompatible routes are diagnosed.

Dimensions edit the selected pulley or idler positions relative to the sketch axes or another component. Horizontal and vertical dimensions set signed coordinate differences; aligned dimensions set center distance while preserving the existing direction. Horizontal and vertical constraints align a pair deterministically. The implementation avoids a general-purpose nonlinear CAD solver.

## Interaction and persistence

The feature tree selects geometry. Objects can be placed, dragged, numerically edited, dimensioned, constrained, routed, and deleted. The user closes a route by selecting its start object again; routes support at least 20 objects. The workspace supports wheel zoom, fit/reset, keyboard escape/delete, and undo/redo. New Sketch restores a starter state. The starter sketch follows the brief's GT2 P1–P4 tooth counts and coordinates. Save a versioned sketch in local storage and provide JSON export/import with validation. An editable comma-separated list of available tooth counts identifies the closest standard belt and signed length adjustment.

Use the brief's dark charcoal and red engineering visual language. Keep controls legible on laptop-sized windows and do not let the canvas cover the toolbars or side panels.

## Acceptance checks

1. Create and edit at least four pulleys, choose each supported profile, set P1 as the origin, and read accurate pitch diameters and coordinates.
2. Define a manual route and see a closed path composed of tangent lines and pulley/idler arcs; displayed length comes from those same primitives.
3. Add and move a back-contact idler; its path, contribution, total length, and tooth results update together.
4. Edit horizontal, vertical, and aligned dimensions; apply horizontal and vertical constraints.
5. See nearest, lower, and higher whole-tooth belts, errors, tolerance status, and concise invalid-geometry messages.
6. Refresh and recover the sketch; export and import a valid design.
7. Verify representative equal-radius and unequal-radius two-pulley cases, plus three-pulley, four-pulley, and idler routing, then run the app and inspect the critical sketch interactions.
