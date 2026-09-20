@echo off
rem After the checks finish: re-run the model proposals against the fresh scan so
rem every verdict is attached to the node it was made on, then rebuild the report.
cd /d "%~dp0"
:wait
findstr /b "EXIT" checks.log >nul 2>&1
if errorlevel 1 (
  timeout /t 30 /nobreak >nul
  goto wait
)
node propose.mjs --redo > propose.log 2>&1
echo EXIT %errorlevel% >> propose.log
