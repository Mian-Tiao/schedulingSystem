@echo off
echo Starting Lean Scheduling Assistant...
start "Backend Server (Port 3001)" cmd /k "cd /d %~dp0server && npm run dev"
start "Frontend Client (Port 5173)" cmd /k "cd /d %~dp0client && npm run dev"
echo Both servers started!
echo Open http://localhost:5173 in your browser.
