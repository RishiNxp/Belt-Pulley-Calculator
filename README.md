# Belt Pulley Calculator

A browser-based, 2D belt-layout workspace built with React, TypeScript, Vite, and SVG. The starter design has four pulleys and saves automatically in your browser. Calculations run locally on your computer.

## Download and run locally

1. Install **[Node.js 24 LTS](https://nodejs.org/en/download)**, which includes npm. Node.js 22.12 or newer is required.
2. On the GitHub repository page, choose **Code → Download ZIP**, then extract the ZIP. You can also clone the repository with Git.
3. Open a terminal in the extracted folder containing `package.json`.
4. Install the dependencies, then start the website:

```sh
npm install
npm start
```

The calculator opens automatically in your browser, usually at `http://127.0.0.1:5173`. Use the address printed in the terminal if that port is busy. Leave the terminal open while using the website and press `Ctrl+C` to stop it. On later launches, run only `npm start`.

**Windows:** after installing Node.js and extracting the ZIP, double-click **`Start Calculator.cmd`**. It installs missing dependencies on the first launch and opens the website in your browser. Leave its window open while using the calculator. In PowerShell, use `npm.cmd` instead of `npm` if PowerShell blocks npm scripts.

Internet is required for the first dependency installation. After setup, `npm start` serves the website locally and works offline.

For a clean, repeatable installation, use `npm ci` in place of `npm install`. Keep `package-lock.json` in the repository; do not include `node_modules` or `dist`.

When updating the source with Git, stop the local server and run `npm ci` again before launching so any changed dependencies are installed.

### Saved designs

The last sketch saves automatically in browser storage. Saved designs belong to that browser and website address. Use the same browser and address to reopen your saved sketch; clearing site data removes the saved design.

## Build the website

Create the static website files:

```sh
npm run build
```

The finished website is in `dist/`. Serve or publish that folder with a static website host. For a local preview of those files, run:

```sh
npm run preview
```

For development without automatically opening a browser, use `npm run dev`. Use `npm run test` for the existing geometry, editing, viewport, and persistence checks.

## Sketching

- Select, pan, add pulleys, create a route, and add smooth back tensioners to a belt segment from the toolbar.
- With Add Pulley active, click a straight belt span to insert a 20T pulley directly into that route. Click empty space to place a separate pulley. Drag or edit an inserted pulley normally; deleting it repairs the belt route.
- While creating a route, click components in order and click the first component again to close it.
- Add horizontal, vertical, or center-distance dimensions by selecting two centers, moving the preview, and clicking to place it. Double-click a dimension value to edit it in place.
- Click a dimension to select its red highlight; use Delete/Backspace to remove it or Escape to deselect. Pulleys and the belt remain.
- Sketch coordinates use +X right and +Y up. Dimensions and alignment constraints stay in millimeters as you pan or zoom.
- Horizontal and vertical constraints keep paired coordinates aligned during edits. The origin pulley stays fixed at (0, 0).
- Drag components, use the mouse wheel to zoom, and press `Ctrl/⌘ Z` or `Ctrl/⌘ Shift Z` to undo or redo.
- Choose GT2, GT3, or HTD 5M; the calculator reports the nearest integer belt tooth count, nominal length, geometric length, signed errors, and tolerance status.
- Choose connected driver/output pulleys in the compact Drive section to see reduction, speed, ideal torque, and optional output RPM. Smooth tensioners do not enter these ratios.

See [BUG_REVIEW.md](BUG_REVIEW.md) for this pass's confirmed fixes and verification results.
