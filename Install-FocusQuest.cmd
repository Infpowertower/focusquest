@echo off
rem Copies FocusQuest into your user profile and adds a Start menu entry. Needs no admin rights.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
