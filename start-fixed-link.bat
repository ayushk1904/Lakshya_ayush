@echo off
cd /d "%~dp0"
node scripts\start-app.js --public --fixed
if errorlevel 1 pause
