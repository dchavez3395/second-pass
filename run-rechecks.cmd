@echo off
cd /d "%~dp0"
node checks.mjs --check headings --redo > rechecks.log 2>&1
node checks.mjs --check link-purpose --redo >> rechecks.log 2>&1
echo EXIT %errorlevel% >> rechecks.log
