@echo off
rem Copies FocusQuest into your user profile and adds a Start menu entry. Needs no admin rights.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if not errorlevel 1 goto end
echo.
echo If the message above says the script is not digitally signed:
echo Windows blocks scripts from a downloaded zip file until you unblock the zip file.
echo   1. Right-click the downloaded zip file and choose Properties.
echo   2. Tick "Unblock" [German: "Zulassen"] at the bottom and click OK.
echo   3. Extract the zip file again and start Install-FocusQuest.cmd from the new folder.
echo This is needed for every new version you download. README.txt explains the details.
:end
echo.
pause
