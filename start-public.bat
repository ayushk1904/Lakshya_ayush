@echo off
cd /d "%~dp0"
node scripts\start-app.js --public
if errorlevel 1 pause
