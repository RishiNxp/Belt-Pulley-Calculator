# Local Desktop Launch Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, honoring the user's advance approval and preference for editing the existing project.

**Goal:** Make the downloaded repository open Belt Pulley Calculator locally in its own window.

**Architecture:** Electron loads the existing production build through a stable local application origin. npm handles dependency installation and builds; a Windows launcher provides a double-click entry.

**Tech Stack:** Existing React/TypeScript/Vite application, Electron, Windows batch launcher.

**Spec:** `docs/superpowers/specs/2026-10-05-local-desktop-design.md`

## Global constraints

- Node.js 22.12 or newer; recommend Node.js 24 LTS.
- Existing calculations and layout stay in the existing React application.
- Install dependencies once online; later launches load only local application assets.
- No new tests or test execution for this request.
- Work in the existing project; do not publish or commit unrelated untracked work.

## Review focus

- Folder names containing spaces: launcher must change to its own quoted directory.
- Repeated launches: focus the open calculator rather than compete for the same profile.
- Assets and autosave: custom scheme must be standard and use a stable origin.
- Missing dependencies or failed builds: stop and show a readable failure.
- Unexpected asset paths: restrict the protocol to the app host and `dist` directory.

## Task 1: Desktop entry and npm setup

**Files:** Create `desktop/main.cjs`; modify `package.json`, `package-lock.json`, and `vite.config.ts`.

**Interface:** `npm start` runs the existing production build and `electron .`; Electron's package entry is `desktop/main.cjs` and loads `belt-pulley://app/index.html`.

- [x] Install the current stable Electron development dependency and record the lockfile.
- [x] Add package entry, Node.js version requirement, and npm start command.
- [x] Implement a local-only protocol, stable application storage path, window lifecycle, and startup error reporting.
- [x] Use relative production asset paths in Vite.

## Task 2: Download-and-run instructions

**Files:** Create `Start Calculator.cmd`; modify `README.md`.

**Interface:** Windows users double-click the launcher after installing Node.js. Terminal users run `npm install` then `npm start` from the extracted directory.

- [x] Create a quoted-directory Windows launcher that installs from the lockfile and reports errors.
- [x] Document ZIP download, Node.js, installation, desktop and browser modes, offline behavior, and separate saved storage.
- [x] Run the production build and review the added source and instructions together.

## Execution record

- Ruling: honor the user's existing advance approval and edit this checkout in place; no extra approval gates or worktree are needed.
- Ruling: do not add or run tests; the developer instruction for this request overrides skill test steps.
- Ruling: complete the review in this session without more review agents, respecting the user's earlier preference.
- Ruling: native UI control is disabled; do not claim a manually verified desktop launch.
- Ruling: Electron 44 downloads its binary lazily by default. Add `postinstall: install-electron` to finish the online setup before the first launch; the installed runtime is Electron 44.5.1.
- Review: create the data directory before setting Electron's userData/sessionData paths; restrict served files to dist; keep the launcher from reinstalling on every run; provide relative built asset URLs.
- Evidence: `npm run postinstall` exited 0 and installed `electron.exe` (245726208 bytes), version 44.5.1.
- Evidence: `node --check desktop/main.cjs` reported no syntax error; the production build exited 0 and emitted 30 modules with relative asset URLs.
- Limitation: desktop window interaction and first-launch behavior on other computers have not been exercised. No tests were added or run.
