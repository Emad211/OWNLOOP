@echo off
setlocal
node "%LOCALAPPDATA%\OwnLoop\app\0.1.0\installer\dist\cli.js" %* 2>nul
set "OWNLOOP_EXIT=%ERRORLEVEL%"
endlocal & exit /b %OWNLOOP_EXIT%
