@echo off
title Nano Banana Auto Bot Server
cd /d "%~dp0"

echo ===================================================
echo   Pruefe Python-Abhaengigkeiten...
echo ===================================================

python -c "import cv2, numpy, flask, dotenv, openai, piexif, PIL" 2>nul
if errorlevel 1 goto install_deps
goto start_server

:install_deps
echo Installiere fehlende Abhaengigkeiten (OpenCV, NumPy)...
pip install -r requirements.txt
if errorlevel 1 (
    echo Installation fehlgeschlagen! Bitte installiere OpenCV und NumPy manuell.
    pause
    exit /b
)

:start_server
echo Alle Abhaengigkeiten bereit!
echo ===================================================
echo   Starte Nano Banana Auto-Bot Server...
echo ===================================================

:: Start Flask server in the background
start "" python app.py

:: Wait 3 seconds for Flask to initialize
ping 127.0.0.1 -n 4 >nul

:: Open browser
echo Oeffne Web-Interface im Browser...
start http://localhost:5080

echo Server laeuft! Schließe dieses Fenster nicht, um den Server aktiv zu halten.
echo ===================================================
pause
