@echo off
cd /d "%~dp0"
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
  where node >nul 2>&1
  if errorlevel 1 (
    echo Node.js was not found. Install Node.js 20 or newer, then run start.cmd again.
    pause
    exit /b 1
  )
)
echo Open http://127.0.0.1:4173 in your browser.
echo Keep this window open while using the app.
"%NODE_EXE%" "%~dp0server.mjs"
pause
