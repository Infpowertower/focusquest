@echo off
rem Copies FocusQuest into your user profile and adds a Start menu entry. Needs no admin rights.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if not errorlevel 1 goto end
echo.
echo If the message above says the script is not digitally signed, this PC only runs
echo signed PowerShell scripts. FocusQuest can then not be installed or started this way.
echo Use the browser version instead. To-dos work there, Jira does not:
echo   https://infpowertower.github.io/focusquest/
echo   or double-click app.html in this folder.
echo README.txt explains the details.
:end
echo.
pause
