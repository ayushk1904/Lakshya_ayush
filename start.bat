@echo off
cd /d "%~dp0"
node scripts\start-app.js
if errorlevel 1 pause
