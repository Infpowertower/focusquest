# Runs after a release was published: starts the helper of the release before it and lets it
# update itself from the real GitHub. Shows that check, download, checksum, install and restart
# work end to end. Exits 0 when it worked or when GitHub gave no usable answer (rate limit),
# 1 when the update itself failed. Keep this file ASCII-only.
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [Parameter(Mandatory = $true)][string]$Expect,
    [int]$Port = 8793
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Dir = (Resolve-Path -LiteralPath $Dir).Path
$base = "http://localhost:$Port"
$script:secret = ''

function Call([string]$method, [string]$path) {
    $status = 0
    $text = ''
    try {
        $r = Invoke-WebRequest -Uri "$base$path" -Method $method -Headers @{ 'X-FQ-Token' = $script:secret } -UseBasicParsing -TimeoutSec 180
        $status = [int]$r.StatusCode
        $text = [string]$r.Content
    } catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }
        $status = [int]$resp.StatusCode
        if ($null -ne $_.ErrorDetails) { $text = [string]$_.ErrorDetails.Message }
    }
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { }
    return @{ status = $status; text = $text; json = $json }
}

$result = 1
try {
    $from = 'unknown'
    $vf = Join-Path $Dir 'version.txt'
    if (Test-Path -LiteralPath $vf) { $from = (Get-Content -LiteralPath $vf -Raw).Trim() }
    Write-Host "Updating $from to $Expect through the real GitHub"

    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Dir\server.ps1`" -NoBrowser -Port $Port" | Out-Null
    $up = $false
    for ($i = 0; $i -lt 60 -and -not $up; $i++) {
        Start-Sleep -Milliseconds 500
        try { $up = ((Invoke-WebRequest -UseBasicParsing -Uri "$base/api/ping" -TimeoutSec 3).Content -match 'focusquest') } catch { }
    }
    if (-not $up) { throw 'The helper of the previous release did not start.' }
    $script:secret = [string]((Get-Content -LiteralPath (Join-Path $Dir 'data\helper-config.json') -Raw) | ConvertFrom-Json).secret

    $c = $null
    for ($i = 0; $i -lt 6; $i++) {
        $c = Call 'GET' '/api/update/check?force=1'
        if ($c.status -eq 404) { Write-Host "::notice::Release $from has no in-app update yet, nothing to test."; $result = 0; break }
        Write-Host ("check: " + $c.text)
        if ($c.json.available -eq $true -and $c.json.latest -eq $Expect) { break }
        Start-Sleep -Seconds 10
    }
    if ($c.status -ne 404) {
        if ($c.json.ok -ne $true) { Write-Host "::warning::GitHub gave no usable answer to the update check: $($c.json.message)"; $result = 0 }
        elseif ($c.json.latest -ne $Expect) { throw "The check reports $($c.json.latest), expected $Expect." }
        else {
            $a = Call 'POST' '/api/update/apply'
            Write-Host ("apply: " + $a.status + ' ' + $a.text)
            if ($a.status -eq 502) { Write-Host '::warning::GitHub gave no usable answer when installing.'; $result = 0 }
            elseif ($a.status -ne 200) { throw 'The update was refused.' }
            else {
                $ok = $false
                for ($i = 0; $i -lt 90 -and -not $ok; $i++) {
                    Start-Sleep -Seconds 1
                    try { $ok = ((Call 'GET' '/api/state').json.version -eq $Expect) } catch { }
                }
                if (-not $ok) { throw 'The helper did not come back with the new version.' }
                Write-Host "ok    release $from updated itself to $Expect and restarted"
                $result = 0
            }
        }
    }
} catch {
    Write-Host ("FAIL  " + $_.Exception.Message) -ForegroundColor Red
    $result = 1
} finally {
    try { Call 'POST' '/api/quit' | Out-Null } catch { }
}
exit $result
