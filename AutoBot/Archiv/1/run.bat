@echo off
echo ===================================================
echo 🤖 AutoBot: Starte Flask-Server und Browser...
echo ===================================================
echo.

:: Start Flask app in a separate command window to keep logs visible
start "AutoBot Flask Server" cmd /k "python app.py"

:: Wait 2 seconds for Flask to initialize
timeout /t 2 >nul

:: Open web application in default browser
echo Oeffne Weboberflaeche unter http://127.0.0.1:5000 ...
start http://127.0.0.1:5000

echo.
echo Fertig! Du kannst dieses Fenster schliessen.
echo Der Server laeuft im anderen Fenster.
exit
