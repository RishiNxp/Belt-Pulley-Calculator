# Repository-based desktop launch

## Goal

Let someone download the GitHub repository, install Node.js, and run the existing Belt Pulley Calculator in its own window. The user has approved implementation choices in advance and requested continuing in the existing project.

## Approach

Use Electron to display the existing React/SVG application. `npm install` downloads dependencies and the desktop runtime once through a postinstall hook; `npm start` builds the local application and opens its window. Keep `npm run dev` for browser development. A Windows `Start Calculator.cmd` launcher checks Node.js, installs missing dependencies, and starts the app.

Electron is appropriate for a source download because it installs through npm without requiring a separate Rust or C++ build environment. No new calculations or layout changes are needed.

## Desktop behavior

- Serve only the built `dist` assets through a standard, secure `belt-pulley://app` scheme; use a stable origin for saved sketches.
- Keep Electron's Node access disabled in the renderer, with context isolation and sandboxing enabled.
- Persist desktop sketch data under the user's application data folder, separately from browser data.
- Open a 1360 by 900 window, with a minimum size of 920 by 640. Show it when the renderer is ready.
- Use one app instance, focus an existing window on repeated launches, and support the usual Windows/Linux quit and macOS activation behavior.
- Show a useful startup error if the local build cannot load.

## Distribution and setup

- Require Node.js 22.12 or newer; recommend Node.js 24 LTS.
- Include `package-lock.json` so `npm ci` installs reproducibly on other computers.
- Explain downloading and extracting GitHub's ZIP, opening a terminal in that folder, installing, and launching.
- Internet is needed for the initial dependency installation. Normal launches use local assets and work offline afterward.
- Provide Windows launcher errors for missing Node.js, installation failures, and startup failures. Handle folder paths containing spaces.
- Prepare local source files; publishing a GitHub repository remains a separate action.

## Completion evidence

Build the application with the desktop dependency installed and review the launcher, package entry, asset paths, and persistence origin. Do not add or run tests for this request. Native UI automation is unavailable in this session, so state any unverified desktop behavior accurately.
