# Belt Pulley Calculator

A local-first, 2D belt-layout workspace built with React, TypeScript, Vite, and SVG. Run it in its own desktop window with Electron, or in a browser while developing. The starter design has four pulleys and saves automatically on your computer.

## Download and run locally

1. Install **[Node.js 24 LTS](https://nodejs.org/en/download)**, which includes npm. Node.js 22.12 or newer is required.
2. On the GitHub repository page, choose **Code → Download ZIP**, then extract the ZIP. You can also clone the repository with Git.
3. Open a terminal in the extracted folder containing `package.json`.
4. Install the dependencies, then open the calculator:

```sh
npm install
npm start
```

The calculator opens in its own desktop window. `npm start` builds the application before opening it, so local code changes are included each time. On later launches, run only `npm start`.

**Windows shortcut:** after installing Node.js and extracting the ZIP, double-click **`Start Calculator.cmd`**. It installs missing dependencies on the first launch and opens the calculator. In PowerShell, use `npm.cmd` instead of `npm` if PowerShell blocks npm scripts.

Internet is required for the first installation, including Electron's download. After setup, `npm start` runs entirely from local files and works offline. No hosted website or separate local web server is needed for desktop mode.

For a clean, repeatable installation, use `npm ci` in place of `npm install`. Keep `package-lock.json` in the repository; do not include `node_modules` or `dist`.

When updating the source with Git, close the app and run `npm ci` again before launching so any changed dependencies are installed.

### Add an icon to your Windows desktop

Double-click **`Create Desktop Shortcut.cmd`** in the extracted project folder. It prepares the application and creates a **Belt Pulley Calculator** icon on your desktop. You can also run `npm run desktop:shortcut` from the project folder.

Double-click that desktop icon to open the calculator directly in its own window. Keep the project folder in place: the shortcut points to its local application files. If you move the folder or update the source, run `Create Desktop Shortcut.cmd` again to rebuild the app and create a shortcut for the current location.

### Saved designs

The last sketch saves automatically in the desktop app's own data folder. On Windows this is `%APPDATA%\BeltPulleyCalculator`. Moving or updating the downloaded repository keeps that saved sketch. The desktop app and browser version have separate saved designs; an existing browser sketch is not automatically copied into desktop mode.

### Browser development

To run the existing browser version:

```sh
npm install
npm run dev
```

Open the local URL printed in the terminal, usually `http://localhost:5173`. Leave that terminal open while using the browser version.

Use `npm run test` for the geometry, editing, viewport, and persistence checks, and `npm run build` for a production build.

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
