@echo off
REM Start both Wisdom Warfare servers
echo Starting Wisdom Warfare Backend Servers...
echo.
echo Opening Terminal 1: Main Server (Port 4001)
start cmd /k "cd /d "%~dp0" && npm start"
timeout /t 2 >nul
echo.
echo Opening Terminal 2: Crossword Server (Port 4002)
start cmd /k "cd /d "%~dp0" && npm run start:crossword"
echo.
echo Both servers should now be starting...
echo Main Server: http://localhost:4001
echo Crossword Server: http://localhost:4002
echo Frontend: http://localhost:3000
echo.
pause
