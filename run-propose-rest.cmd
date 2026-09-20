@echo off
cd /d "%~dp0"
node propose.mjs --redo --site morden.ca >> propose.log 2>&1
node propose.mjs --redo --site mpi.mb.ca >> propose.log 2>&1
node propose.mjs --redo --site myselkirk.ca >> propose.log 2>&1
node propose.mjs --redo --site northernhealthregion.com >> propose.log 2>&1
node propose.mjs --redo --site pembinatrails.ca >> propose.log 2>&1
node propose.mjs --redo --site prairiemountainhealth.ca >> propose.log 2>&1
node propose.mjs --redo --site retsd.mb.ca >> propose.log 2>&1
node propose.mjs --redo --site rrc.ca >> propose.log 2>&1
node propose.mjs --redo --site sharedhealthmb.ca >> propose.log 2>&1
node propose.mjs --redo --site sjasd.ca >> propose.log 2>&1
node propose.mjs --redo --site southernhealth.ca >> propose.log 2>&1
node propose.mjs --redo --site steinbach.ca >> propose.log 2>&1
node propose.mjs --redo --site thompson.ca >> propose.log 2>&1
node propose.mjs --redo --site travelmanitoba.com >> propose.log 2>&1
node propose.mjs --redo --site umanitoba.ca >> propose.log 2>&1
node propose.mjs --redo --site ustboniface.ca >> propose.log 2>&1
node propose.mjs --redo --site uwinnipeg.ca >> propose.log 2>&1
node propose.mjs --redo --site wcb.mb.ca >> propose.log 2>&1
node propose.mjs --redo --site winnipeg.ca >> propose.log 2>&1
node propose.mjs --redo --site winnipegsd.ca >> propose.log 2>&1
node propose.mjs --redo --site wrha.mb.ca >> propose.log 2>&1
echo EXIT %errorlevel% >> propose.log
