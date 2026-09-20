@echo off
rem Full rescan, detached from any terminal. Progress in diagnose-full.log.
cd /d "%~dp0"
node diagnose.mjs --file urls.txt > diagnose-full.log 2>&1
echo EXIT %errorlevel% >> diagnose-full.log
