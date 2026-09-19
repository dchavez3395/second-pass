@echo off
rem Waits for a running diagnose scan to finish, rebuilds scan-audit.md, then runs the
rem model layer over every review item. Resumable: propose.mjs skips findings it has done.
cd /d "%~dp0"
:wait
findstr /b "EXIT" diagnose-full.log >nul 2>&1
if errorlevel 1 (
  timeout /t 15 /nobreak >nul
  goto wait
)
node diagnose.mjs --report-only
node propose.mjs > propose.log 2>&1
echo EXIT %errorlevel% >> propose.log
