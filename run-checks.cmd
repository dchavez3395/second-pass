@echo off
rem Model checks over every site, detached. Progress in checks.log. Resumable.
cd /d "%~dp0"
node checks.mjs > checks.log 2>&1
echo EXIT %errorlevel% >> checks.log
