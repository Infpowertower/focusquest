# FocusQuest installer
# Copies the app into a folder in your user profile and adds a Start menu entry.
# Needs no admin rights. An existing "data" folder in the target is never touched,
# so running this again with a newer download updates the app and keeps your data.
# Keep this file ASCII-only (Windows PowerShell 5.1).

param(
    [string]$TargetDir = '',
    [switch]$NoShortcut,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrEmpty($TargetDir)) { $TargetDir = Join-Path $env:LOCALAPPDATA 'FocusQuest' }

$required = @('app.html', 'server.ps1', 'Start-FocusQuest.cmd')
$optional = @('README.txt', 'LICENSE.txt', 'version.txt')

try {
    foreach ($f in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $f))) {
            throw "$f is missing next to install.ps1. Extract the whole zip file first, then run the installer again."
        }
    }

    if (-not (Test-Path -LiteralPath $TargetDir)) { New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null }
    $target = (Resolve-Path -LiteralPath $TargetDir).Path
    $sameFolder = ($target.TrimEnd('\') -ieq $source.TrimEnd('\'))

    if (-not $sameFolder) {
        foreach ($f in ($required + $optional)) {
            $from = Join-Path $source $f
            if (Test-Path -LiteralPath $from) {
                Copy-Item -LiteralPath $from -Destination (Join-Path $target $f) -Force
            }
        }
    }

    # Downloaded files carry a "came from the internet" mark that makes Windows ask before running them.
    foreach ($f in ($required + $optional)) {
        $p = Join-Path $target $f
        if (Test-Path -LiteralPath $p) {
            try { Unblock-File -LiteralPath $p } catch { }
        }
    }

    Write-Host "FocusQuest is installed in $target"

    $launcher = Join-Path $target 'Start-FocusQuest.cmd'
    if (-not $NoShortcut) {
        try {
            $programs = [Environment]::GetFolderPath('Programs')
            if (-not (Test-Path -LiteralPath $programs)) { New-Item -ItemType Directory -Path $programs -Force | Out-Null }
            $lnk = Join-Path $programs 'FocusQuest.lnk'
            $shell = New-Object -ComObject WScript.Shell
            $sc = $shell.CreateShortcut($lnk)
            $sc.TargetPath = $launcher
            $sc.WorkingDirectory = $target
            $sc.WindowStyle = 7
            $sc.Description = 'FocusQuest - to-dos and Jira tickets'
            $sc.Save()
            Write-Host 'Start menu entry created: FocusQuest'
        } catch {
            Write-Host 'The Start menu entry could not be created:' -ForegroundColor Yellow
            Write-Host $_.Exception.Message -ForegroundColor Yellow
            Write-Host "You can still start FocusQuest with $launcher" -ForegroundColor Yellow
        }
    }

    if (-not $NoStart) {
        Write-Host 'Starting FocusQuest ...'
        Start-Process -FilePath $launcher -WorkingDirectory $target
    }
    Write-Host ''
    if ($sameFolder) { Write-Host 'Done.' }
    else { Write-Host 'Done. You can delete the downloaded zip file and the extracted folder.' }
    exit 0
} catch {
    Write-Host ''
    Write-Host 'FocusQuest could not be installed:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
