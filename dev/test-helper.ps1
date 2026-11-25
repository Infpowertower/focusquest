# Tests for server.ps1 on Windows PowerShell 5.1: the safety checks of the routes and the whole
# update path, against a local stand-in for GitHub (dev/fake-github.js). Needs node on the PATH.
#   powershell -ExecutionPolicy Bypass -File dev\test-helper.ps1 -Install <folder with an installed FocusQuest>
# The folder is updated to made-up versions 9.9.8 and 9.9.9 during the test. Keep this file ASCII-only.
param(
    [Parameter(Mandatory = $true)][string]$Install,
    [int]$Port = 8792,
    [int]$FakePort = 8950
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
$utf8 = New-Object System.Text.UTF8Encoding($false)
$Install = (Resolve-Path -LiteralPath $Install).Path
$base = "http://localhost:$Port"
$fake = Join-Path $env:TEMP ('fq-fake-' + [Guid]::NewGuid().ToString('N'))
$orig = Join-Path $fake 'orig'
$script:failed = 0
$script:secret = ''

function Check([bool]$cond, [string]$name) {
    if ($cond) { Write-Host "ok    $name" }
    else { Write-Host "FAIL  $name" -ForegroundColor Red; $script:failed++ }
}

# One request to the helper. Returns status, text and (if the text is JSON) the parsed object.
function Call([string]$method, [string]$path, $body = $null, [hashtable]$headers = $null, [switch]$NoToken) {
    $h = @{}
    if (-not $NoToken) { $h['X-FQ-Token'] = $script:secret }
    if ($null -ne $headers) { foreach ($k in $headers.Keys) { $h[$k] = $headers[$k] } }
    $a = @{ Uri = "$base$path"; Method = $method; Headers = $h; UseBasicParsing = $true; TimeoutSec = 180 }
    if ($null -ne $body) { $a.Body = $utf8.GetBytes([string]$body); $a.ContentType = 'application/json' }
    $status = 0
    $text = ''
    try {
        $r = Invoke-WebRequest @a
        $status = [int]$r.StatusCode
        $text = $utf8.GetString($r.RawContentStream.ToArray())
    } catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }
        $status = [int]$resp.StatusCode
        # Windows PowerShell has already read the body of an error answer once: rewind before reading it again.
        $stream = $resp.GetResponseStream()
        try { $stream.Position = 0 } catch { }
        $sr = New-Object System.IO.StreamReader($stream, $utf8)
        $text = $sr.ReadToEnd()
        if ($text -eq '' -and $null -ne $_.ErrorDetails) { $text = [string]$_.ErrorDetails.Message }
    }
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { }
    return @{ status = $status; text = $text; json = $json }
}

function Test-Up {
    try { return ((Invoke-WebRequest -UseBasicParsing -Uri "$base/api/ping" -TimeoutSec 3).Content -match 'focusquest') } catch { return $false }
}
function Wait-Up([bool]$up) {
    for ($i = 0; $i -lt 60; $i++) {
        if ((Test-Up) -eq $up) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
function Wait-Version([string]$ver) {
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1
        try { if ((Call 'GET' '/api/state').json.version -eq $ver) { return $true } } catch { }
    }
    return $false
}
function Start-Helper {
    return (Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Install\server.ps1`" -NoBrowser -Port $Port")
}
function Get-Hashes {
    $o = @{}
    foreach ($f in 'app.html', 'server.ps1', 'Start-FocusQuest.cmd', 'version.txt') { $o[$f] = (Get-FileHash -LiteralPath (Join-Path $Install $f)).Hash }
    return ($o.Keys | Sort-Object | ForEach-Object { "$_=$($o[$_])" }) -join ';'
}
function Read-Installed([string]$name) { return [System.IO.File]::ReadAllText((Join-Path $Install $name), $utf8) }
function Set-Scenario([string]$name) { [System.IO.File]::WriteAllText((Join-Path $fake 'current.txt'), $name) }

function Add-Entry($zip, [string]$name, [byte[]]$bytes) {
    $s = $zip.CreateEntry($name).Open()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
}
# Builds a release the way the real workflow does: FocusQuest-<version>.zip, its .sha256 and the API answer.
function New-Release([string]$scenario, [string]$ver, [switch]$BadHash, [switch]$Evil) {
    $dir = Join-Path $fake $scenario
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $zipName = "FocusQuest-$ver.zip"
    $zipPath = Join-Path $dir $zipName
    $fs = [System.IO.File]::Create($zipPath)
    $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    foreach ($f in 'server.ps1', 'Start-FocusQuest.cmd', 'README.txt', 'LICENSE.txt') {
        Add-Entry $zip "FocusQuest/$f" ([System.IO.File]::ReadAllBytes((Join-Path $orig $f)))
    }
    $page = [System.IO.File]::ReadAllText((Join-Path $orig 'app.html'), $utf8) + "`n<!-- test build $ver -->`n"
    Add-Entry $zip 'FocusQuest/app.html' ($utf8.GetBytes($page))
    Add-Entry $zip 'FocusQuest/version.txt' ($utf8.GetBytes("$ver`r`n"))
    if ($Evil) {
        $junk = $utf8.GetBytes('Write-Host "this must never be written"')
        Add-Entry $zip 'FocusQuest/extra.ps1' $junk
        Add-Entry $zip '../escaped.txt' $junk
        Add-Entry $zip 'FocusQuest/../../escaped2.txt' $junk
        Add-Entry $zip 'FocusQuest/data/focusquest-data.json' ($utf8.GetBytes('{"evil":true}'))
        Add-Entry $zip 'FocusQuest/data/helper-config.json' ($utf8.GetBytes('{"secret":"evil"}'))
    }
    $zip.Dispose()
    $fs.Dispose()
    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLower()
    if ($BadHash) { $hash = '0' * 64 }
    [System.IO.File]::WriteAllText((Join-Path $dir ($zipName + '.sha256')), "$hash  $zipName`n")
    $url = "http://localhost:$FakePort/$scenario/$zipName"
    $rel = @{
        tag_name = "v$ver"; draft = $false; prerelease = $false; published_at = '2026-11-20T10:00:00Z'
        body = "## What's new`n- Test release $ver`n`n<!-- install -->`nInstall text"
        assets = @(@{ name = $zipName; browser_download_url = $url }, @{ name = ($zipName + '.sha256'); browser_download_url = ($url + '.sha256') })
    }
    [System.IO.File]::WriteAllText((Join-Path $dir 'latest.json'), ($rel | ConvertTo-Json -Depth 5))
}

$fakeProc = $null
try {
    # ------------------------------------------------------------ set-up
    New-Item -ItemType Directory -Path $orig -Force | Out-Null
    foreach ($f in 'app.html', 'server.ps1', 'Start-FocusQuest.cmd', 'README.txt', 'LICENSE.txt', 'version.txt') {
        Copy-Item -LiteralPath (Join-Path $Install $f) -Destination (Join-Path $orig $f)
    }
    $cur = (Read-Installed 'version.txt').Trim()
    New-Release 'same' $cur
    New-Release 'badhash' '9.9.9' -BadHash
    New-Release 'evil' '9.9.8' -Evil
    New-Release 'good' '9.9.9'
    New-Item -ItemType Directory -Path (Join-Path $fake 'down') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $fake 'down\drop.txt'), '1')
    New-Item -ItemType Directory -Path (Join-Path $fake 'ratelimit') | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $fake 'ratelimit\status.txt'), '403')
    Set-Scenario 'same'

    $fakeProc = Start-Process -FilePath 'node' -PassThru -WindowStyle Hidden -ArgumentList "`"$PSScriptRoot\fake-github.js`" `"$fake`" $FakePort"
    $env:FOCUSQUEST_UPDATE_API = "http://localhost:$FakePort/latest"
    Start-Helper | Out-Null
    if (-not (Wait-Up $true)) { throw 'The helper did not start.' }
    $script:secret = [string]((Get-Content -LiteralPath (Join-Path $Install 'data\helper-config.json') -Raw) | ConvertFrom-Json).secret

    # ------------------------------------------------------------ routes
    Check ((Call 'GET' '/api/state' -NoToken).status -eq 403) 'no secret: refused'
    Check ((Call 'GET' '/api/update/check' -NoToken).status -eq 403) 'update check without secret: refused'
    Check ((Call 'POST' '/api/update/apply' -NoToken).status -eq 403) 'update install without secret: refused'
    Check ((Call 'GET' '/api/state' $null @{ Origin = 'http://evil.example' }).status -eq 403) 'foreign origin: refused'
    $st = Call 'GET' '/api/state'
    Check ($st.status -eq 200 -and $st.json.version -eq $cur) "state reports version $cur"
    $data = '{"note":"Gr' + [char]0xFC + [char]0xDF + 'e ' + [char]::ConvertFromUtf32(0x1F389) + '","items":[]}'
    Check ((Call 'PUT' '/api/data' $data).status -eq 200) 'data saved'
    Check ((Call 'GET' '/api/data').text -eq $data) 'data comes back unchanged, umlauts and emoji included'

    # ------------------------------------------------------------ PC session and start with Windows
    $awake = [DateTime]::Parse([string]$st.json.awakeSince, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
    Check (([DateTime]::UtcNow - $awake.ToUniversalTime()).TotalSeconds -lt 120 -and ([DateTime]::UtcNow - $awake.ToUniversalTime()).TotalSeconds -ge 0) 'state reports when this PC session began'
    $link = Join-Path ([Environment]::GetFolderPath('Startup')) 'FocusQuest.lnk'
    $hadLink = Test-Path -LiteralPath $link
    Check ((Call 'POST' '/api/autostart' '{"enabled":false}').json.autostart -eq $false -and -not (Test-Path -LiteralPath $link)) 'start with Windows switched off: no shortcut'
    $r = Call 'POST' '/api/autostart' '{"enabled":true}'
    Check ($r.status -eq 200 -and $r.json.autostart -eq $true -and (Test-Path -LiteralPath $link)) 'start with Windows switched on: shortcut in the Startup folder'
    if (Test-Path -LiteralPath $link) {
        $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
        Check ($sc.TargetPath -eq (Join-Path $Install 'Start-FocusQuest.cmd')) 'the shortcut starts this FocusQuest'
    }
    Check ((Call 'GET' '/api/state').json.autostart -eq $true) 'state reports start with Windows'
    Check ((Call 'POST' '/api/autostart' '{"enabled":true}' -NoToken).status -eq 403) 'start with Windows without secret: refused'
    if (-not $hadLink) { Call 'POST' '/api/autostart' '{"enabled":false}' | Out-Null }

    # ------------------------------------------------------------ log, second start, restart
    $ping = (Invoke-WebRequest -UseBasicParsing -Uri "$base/api/ping" -TimeoutSec 5).Content | ConvertFrom-Json
    Check ($ping.version -eq $cur) 'ping reports the version'
    $lg = Call 'GET' '/api/log'
    $all = (@($lg.json.lines) -join "`n")
    Check ($lg.status -eq 200 -and $all -match 'FocusQuest helper \S+ starting' -and $all -match 'Listening on') 'log lists the start'
    Check ($all -match 'POST /api/autostart -> 200' -and $all -match 'GET /api/state -> 403 .*Forbidden') 'log lists calls and refusals'
    Check ($all -notmatch [regex]::Escape($script:secret) -and $all -notmatch [regex]::Escape($env:USERPROFILE)) 'log holds neither the secret nor the user folder'
    Check ((Call 'GET' '/api/log' -NoToken).status -eq 403) 'log without secret: refused'
    Check (Test-Path -LiteralPath (Join-Path $Install 'data\helper.log')) 'log is also written to data\helper.log'
    $a1 = [string](Call 'GET' '/api/state').json.awakeSince
    $second = Start-Helper
    Check ($second.WaitForExit(30000)) 'second start of the same version: ends by itself'
    Check ([string](Call 'GET' '/api/state').json.awakeSince -eq $a1) 'second start of the same version: the running helper is left alone'
    Check ((Call 'POST' '/api/restart').status -eq 200) 'restart accepted'
    $again = $false
    for ($i = 0; $i -lt 60 -and -not $again; $i++) {
        Start-Sleep -Milliseconds 500
        try { $a2 = [string](Call 'GET' '/api/state').json.awakeSince; $again = ($a2 -ne '' -and $a2 -ne $a1) } catch { }
    }
    Check $again 'helper restarted by itself'

    # ------------------------------------------------------------ update check
    $r = (Call 'GET' '/api/update/check?force=1').json
    Check ($r.ok -eq $true -and $r.available -eq $false -and $r.current -eq $cur -and $r.latest -eq $cur) 'same version on GitHub: nothing to do'
    Check ((Call 'POST' '/api/update/apply').status -eq 409) 'install without a newer version: refused'
    Set-Scenario 'good'
    $r = (Call 'GET' '/api/update/check').json
    Check ($r.available -eq $false) 'the answer is remembered: no second request to GitHub'
    $r = (Call 'GET' '/api/update/check?force=1').json
    Check ($r.ok -eq $true -and $r.available -eq $true -and $r.latest -eq '9.9.9' -and $r.notes -match 'Test release 9.9.9') 'newer version found, with notes'
    Check (((Get-Content -LiteralPath (Join-Path $Install 'data\helper-config.json') -Raw) | ConvertFrom-Json).updateCache -match '9\.9\.9') 'answer stored for the next start'
    Set-Scenario 'down'
    $c = Call 'GET' '/api/update/check?force=1'
    Check ($c.status -eq 200 -and $c.json.ok -eq $false -and $c.json.available -eq $false -and $c.json.message -match 'could not be reached') 'GitHub unreachable: a quiet "could not check"'
    Set-Scenario 'ratelimit'
    $c = Call 'GET' '/api/update/check?force=1'
    Check ($c.status -eq 200 -and $c.json.ok -eq $false -and $c.json.message -match 'not answering') 'rate limit (403): a quiet "could not check"'
    Check ((Call 'POST' '/api/update/apply').status -eq 502) 'install while GitHub does not answer: refused'

    # ------------------------------------------------------------ damaged download
    Set-Scenario 'badhash'
    $before = Get-Hashes
    $c = Call 'POST' '/api/update/apply'
    Write-Host "      helper said: $($c.text)"
    Check ($c.status -eq 500 -and $c.text -match 'checksum') 'wrong checksum: update refused'
    Check ((Get-Hashes) -eq $before) 'wrong checksum: installed files untouched'
    Check ((Call 'GET' '/api/state').json.version -eq $cur) 'wrong checksum: helper keeps running'

    # ------------------------------------------------------------ archive with extra and path-escaping entries
    Set-Scenario 'evil'
    $c = Call 'POST' '/api/update/apply'
    Check ($c.status -eq 200 -and $c.json.restarting -eq $true) 'update 9.9.8 accepted'
    Check (Wait-Version '9.9.8') 'helper restarted by itself as 9.9.8'
    Check ((Read-Installed 'app.html') -match 'test build 9\.9\.8') 'new app.html installed'
    Check (-not (Test-Path -LiteralPath (Join-Path $Install 'extra.ps1'))) 'file that is not on the list: not installed'
    $stray = @(Get-ChildItem -LiteralPath $Install -Recurse -File | Where-Object { $_.Name -like 'escaped*' -or $_.Name -eq 'extra.ps1' })
    $stray += @(Get-ChildItem -LiteralPath (Split-Path -Parent $Install) -File | Where-Object { $_.Name -like 'escaped*' })
    Check ($stray.Count -eq 0) 'entries with ..\ in their path: written nowhere'
    Check ((Call 'GET' '/api/data').text -eq $data) 'data file untouched by the update'
    Check ((Read-Installed 'data\update\previous\version.txt').Trim() -eq $cur) 'previous version kept in data\update\previous'
    Check (Test-Path -LiteralPath (Join-Path $Install "data\backups\pre-update-$cur.json")) 'data copied to backups before the update'
    Check ((Call 'GET' '/api/update/check?force=1').json.available -eq $false) 'after the update: up to date'

    # ------------------------------------------------------------ copy fails midway
    Set-Scenario 'good'
    $before = Get-Hashes
    # Others may still read this file (so the copy of the current version works) but not replace it:
    # app.html and server.ps1 are already overwritten when the update reaches it.
    $lock = [System.IO.File]::Open((Join-Path $Install 'Start-FocusQuest.cmd'), 'Open', 'Read', 'Read')
    try { $c = Call 'POST' '/api/update/apply' } finally { $lock.Close() }
    Write-Host "      helper said: $($c.text)"
    Check ($c.status -eq 500 -and $c.text -match 'put back') 'a file cannot be replaced: update stops'
    Check ((Get-Hashes) -eq $before) 'a file cannot be replaced: the files already copied are put back'
    Check ((Call 'GET' '/api/state').json.version -eq '9.9.8') 'a file cannot be replaced: helper keeps running as 9.9.8'

    # ------------------------------------------------------------ normal update
    $c = Call 'POST' '/api/update/apply'
    Check ($c.status -eq 200 -and $c.json.version -eq '9.9.9') 'update 9.9.9 accepted'
    Check (Wait-Version '9.9.9') 'helper restarted by itself as 9.9.9'
    Check ((Read-Installed 'app.html') -match 'test build 9\.9\.9') 'new app.html installed'
    Check ((Read-Installed 'data\update\previous\version.txt').Trim() -eq '9.9.8') 'previous version is now 9.9.8'
    Check ((Call 'GET' '/api/data').text -eq $data) 'data file still untouched'
    $page = Invoke-WebRequest -UseBasicParsing -Uri "$base/" -TimeoutSec 10
    Check ($page.Content -match 'test build 9\.9\.9' -and $page.Content -notmatch '__FQ_TOKEN__') 'updated page is served with the secret filled in'
 
    # ------------------------------------------------------------ files updated by hand while the old helper keeps running
    [System.IO.File]::WriteAllText((Join-Path $Install 'version.txt'), "9.9.10`r`n")
    Start-Helper | Out-Null
    Check (Wait-Version '9.9.10') 'a start from newer files replaces the helper that is still running'
    $all = (@((Call 'GET' '/api/log').json.lines) -join "`n")
    Check ($all -match "version '9\.9\.9' is running") 'the log says that it took over'
} catch {
    Write-Host ("FAIL  test run stopped: " + $_.Exception.Message) -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
    $script:failed++
} finally {
    try { Call 'POST' '/api/quit' | Out-Null } catch { }
    if ($null -ne $fakeProc) { try { $fakeProc.Kill() } catch { } }
    $env:FOCUSQUEST_UPDATE_API = $null
    Wait-Up $false | Out-Null
    try { Remove-Item -LiteralPath $fake -Recurse -Force } catch { }
}

if ($script:failed -gt 0) { Write-Host "$($script:failed) check(s) failed." -ForegroundColor Red; exit 1 }
Write-Host 'All helper checks passed.'
exit 0
