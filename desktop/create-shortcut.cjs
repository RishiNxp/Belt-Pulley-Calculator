const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.error('The desktop shortcut helper is for Windows. Use npm start on other systems.');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
if (!existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
  console.error('Build the calculator first with npm run build.');
  process.exit(1);
}

let executable;
try {
  executable = require('electron');
} catch (error) {
  console.error('Install the desktop dependencies with npm install first.');
  console.error(error.message);
  process.exit(1);
}
if (!existsSync(executable)) {
  console.error('Electron is missing. Run npm install to complete setup.');
  process.exit(1);
}

// Use Command with a fixed script body; paths are environment data, not code.
const script = readFileSync(path.join(__dirname, 'create-shortcut.ps1'), 'utf8');
const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  env: {
    ...process.env,
    BELT_CALCULATOR_PROJECT: projectRoot,
    BELT_CALCULATOR_EXECUTABLE: executable,
  },
  encoding: 'utf8',
  windowsHide: true,
});
if (result.error || result.status !== 0) {
  console.error('Could not create the desktop shortcut.');
  console.error(result.error?.message || result.stderr?.trim() || 'Windows shortcut setup failed.');
  process.exit(1);
}
console.log('Desktop shortcut created:\n' + result.stdout.trim());
