@echo off
title Nano Banana Auto Bot Server
cd /d "%~dp0"

echo ===================================================
echo   Starte Nano Banana Auto-Bot Server...
echo ===================================================

:: Start Flask server in the background
start "" python app.py

:: Wait 3 seconds for Flask to initialize
timeout /t 3 /nobreak >nul

:: Open browser
echo Oeffne Web-Interface im Browser...
start http://localhost:5080

echo Server laeuft! Schließe dieses Fenster nicht, um den Server aktiv zu halten.
echo ===================================================
pause
