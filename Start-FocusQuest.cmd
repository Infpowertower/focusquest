@echo off
rem Starts the FocusQuest helper (Windows PowerShell, built into Windows 11) and opens the app in your browser.
start "FocusQuest helper" /min powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
