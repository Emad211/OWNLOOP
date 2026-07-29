@echo off
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0ownloop.ps1" %* 2>nul
exit /b %ERRORLEVEL%
