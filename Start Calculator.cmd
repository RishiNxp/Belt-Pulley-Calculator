@echo off
setlocal
title Belt Pulley Calculator
pushd "%~dp0"
if errorlevel 1 goto folder_error

where node.exe >nul 2>nul
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node

node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)"
if errorlevel 1 goto old_node

if not exist "node_modules\.bin\vite.cmd" goto install
if not exist "node_modules\.bin\tsc.cmd" goto install
goto launch

:install
echo First-time setup for Belt Pulley Calculator...
call npm.cmd ci --include=dev --prefer-offline --no-audit --no-fund
if errorlevel 1 goto install_error

:launch
echo Opening Belt Pulley Calculator in your browser...
echo Keep this window open while using the website. Press Ctrl+C to stop it.
call npm.cmd start
if errorlevel 1 goto start_error
popd
exit /b 0

:missing_node
echo Install Node.js 24 LTS from https://nodejs.org/en/download first.
echo Then close this window and double-click this launcher again.
goto failure

:old_node
echo This calculator needs Node.js 22.12 or newer.
echo Install Node.js 24 LTS from https://nodejs.org/en/download and try again.
goto failure

:install_error
echo.
echo Dependency setup failed. The first setup needs an internet connection.
echo Check the messages above, then run this launcher again.
goto failure

:start_error
echo.
echo The calculator could not start. Check the messages above.
goto failure

:folder_error
echo Could not open the repository folder. Extract the ZIP before launching.
pause
exit /b 1

:failure
pause
popd
exit /b 1
