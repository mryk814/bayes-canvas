@echo off
setlocal
cd /d "%~dp0"
title Bayes Canvas

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install the current Node.js LTS release, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "app\node_modules\.bin\vite.cmd" (
  echo Preparing Bayes Canvas for the first launch...
  call npm.cmd --prefix app ci
  if errorlevel 1 (
    echo.
    echo Setup failed. Check the message above and try again.
    pause
    exit /b 1
  )
)

echo Starting Bayes Canvas...
echo The browser will open automatically. Press Ctrl+C here to stop.
call npm.cmd start

if errorlevel 1 (
  echo.
  echo Bayes Canvas stopped with an error.
  pause
  exit /b 1
)
