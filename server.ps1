# FocusQuest local helper
# Serves the app on http://localhost, keeps your data in the "data" folder next to this
# script and relays REST calls to your Jira Data Center (browsers cannot call Jira directly).
# Needs no installation and no admin rights. Keep this file ASCII-only (Windows PowerShell 5.1).

param(
    [int]$Port = 0,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

trap {
    Write-Host ''
    Write-Host 'FocusQuest could not start:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to close this window' | Out-Null
    exit 1
}

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$appFile  = Join-Path $root 'app.html'
$dataDir  = Join-Path $root 'data'
$dataFile = Join-Path $dataDir 'focusquest-data.json'
$cfgFile  = Join-Path $dataDir 'helper-config.json'
$utf8     = New-Object System.Text.UTF8Encoding($false)
$script:lastBackupDay = ''
$script:running = $true

if (-not (Test-Path -LiteralPath $appFile)) { throw "app.html is missing. It must be in the same folder as server.ps1 ($root)." }
if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

Add-Type -AssemblyName System.Net.Http
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

# ---------------------------------------------------------------- configuration
$cfg = @{
    port           = 8765
    secret         = ''
    jiraBaseUrl    = ''
    jiraToken      = ''
    useSystemProxy = $true
}

if (Test-Path -LiteralPath $cfgFile) {
    try {
        $saved = [System.IO.File]::ReadAllText($cfgFile, $utf8) | ConvertFrom-Json
        foreach ($k in @($cfg.Keys)) {
            if ($null -ne $saved.$k) { $cfg[$k] = $saved.$k }
        }
    } catch {
        Write-Host 'helper-config.json could not be read. Starting with default settings.' -ForegroundColor Yellow
    }
}

function Save-Config {
    [System.IO.File]::WriteAllText($cfgFile, ($cfg | ConvertTo-Json), $utf8)
}

if ([string]::IsNullOrEmpty([string]$cfg.secret)) {
    $cfg.secret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    Save-Config
}
if ($Port -gt 0) { $cfg.port = $Port }

# The Jira token is stored encrypted with Windows DPAPI: only your Windows user on this PC can read it.
function Protect-Token([string]$plain) {
    if ([string]::IsNullOrEmpty($plain)) { return '' }
    $sec = ConvertTo-SecureString -String $plain -AsPlainText -Force
    return (ConvertFrom-SecureString -SecureString $sec)
}

function Unprotect-Token([string]$enc) {
    if ([string]::IsNullOrEmpty($enc)) { return '' }
    try {
        $sec = ConvertTo-SecureString -String $enc
        return (New-Object System.Net.NetworkCredential('', $sec)).Password
    } catch {
        return ''
    }
}

# ---------------------------------------------------------------- http client for Jira
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$handler.UseCookies = $false
$handler.UseProxy = [bool]$cfg.useSystemProxy
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(60)

# ---------------------------------------------------------------- response helpers
function Send-Bytes($ctx, [int]$status, [string]$contentType, [byte[]]$bytes) {
    if ($null -eq $bytes) { $bytes = New-Object byte[] 0 }
    $res = $ctx.Response
    $res.StatusCode = $status
    $res.AddHeader('Cache-Control', 'no-store')
    $res.AddHeader('X-Content-Type-Options', 'nosniff')
    if ($status -eq 204 -or $status -eq 304) {
        $res.ContentLength64 = 0
        $res.OutputStream.Close()
        return
    }
    $res.ContentType = $contentType
    $res.ContentLength64 = $bytes.Length
    if ($bytes.Length -gt 0) { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    $res.OutputStream.Close()
}

function Send-Text($ctx, [int]$status, [string]$contentType, [string]$text) {
    $b = $utf8.GetBytes($text)
    Send-Bytes $ctx $status $contentType $b
}

function Send-Json($ctx, [int]$status, $obj) {
    Send-Text $ctx $status 'application/json; charset=utf-8' ($obj | ConvertTo-Json -Depth 6 -Compress)
}

function Send-Error($ctx, [int]$status, [string]$message) {
    Send-Json $ctx $status @{ errorMessages = @($message) }
}

function Read-Body($req) {
    if (-not $req.HasEntityBody) { return '' }
    $sr = New-Object System.IO.StreamReader($req.InputStream, $utf8)
    try { return $sr.ReadToEnd() } finally { $sr.Close() }
}

# ---------------------------------------------------------------- data file
function Save-Data([string]$json) {
    $day = (Get-Date).ToString('yyyy-MM-dd')
    if ((Test-Path -LiteralPath $dataFile) -and ($script:lastBackupDay -ne $day)) {
        # one backup per day, the last 14 are kept
        $bdir = Join-Path $dataDir 'backups'
        if (-not (Test-Path -LiteralPath $bdir)) { New-Item -ItemType Directory -Path $bdir | Out-Null }
        $target = Join-Path $bdir "focusquest-$day.json"
        if (-not (Test-Path -LiteralPath $target)) { [System.IO.File]::Copy($dataFile, $target) }
        $old = Get-ChildItem -LiteralPath $bdir -Filter 'focusquest-*.json' | Sort-Object Name -Descending | Select-Object -Skip 14
        foreach ($f in $old) { try { [System.IO.File]::Delete($f.FullName) } catch { } }
        $script:lastBackupDay = $day
    }
    $tmp = "$dataFile.tmp"
    [System.IO.File]::WriteAllText($tmp, $json, $utf8)
    if (Test-Path -LiteralPath $dataFile) { [System.IO.File]::Delete($dataFile) }
    [System.IO.File]::Move($tmp, $dataFile)
}

# ---------------------------------------------------------------- Jira relay
function Invoke-JiraRelay($ctx) {
    $req = $ctx.Request
    if ([string]::IsNullOrEmpty([string]$cfg.jiraBaseUrl)) {
        Send-Error $ctx 400 'The Jira address is not set yet. Open Settings and fill in the Jira connection.'
        return
    }
    $rest = $req.RawUrl.Substring(6)   # everything after "/jira/"
    if (-not $rest.StartsWith('rest/')) {
        Send-Error $ctx 400 'Only Jira REST calls are relayed.'
        return
    }
    $target = ([string]$cfg.jiraBaseUrl).TrimEnd('/') + '/' + $rest
    $method = New-Object System.Net.Http.HttpMethod($req.HttpMethod)
    $msg = New-Object System.Net.Http.HttpRequestMessage($method, $target)
    $tok = Unprotect-Token ([string]$cfg.jiraToken)
    if (-not [string]::IsNullOrEmpty($tok)) {
        $msg.Headers.TryAddWithoutValidation('Authorization', "Bearer $tok") | Out-Null
    }
    $msg.Headers.TryAddWithoutValidation('Accept', 'application/json') | Out-Null
    $msg.Headers.TryAddWithoutValidation('X-Atlassian-Token', 'no-check') | Out-Null
    $msg.Headers.TryAddWithoutValidation('User-Agent', 'FocusQuest/1.0') | Out-Null
    if ($req.HasEntityBody) {
        $body = Read-Body $req
        $msg.Content = New-Object System.Net.Http.StringContent($body, $utf8, 'application/json')
    }
    try {
        $resp = $client.SendAsync($msg).GetAwaiter().GetResult()
    } catch {
        Send-Error $ctx 502 ('Jira could not be reached: ' + $_.Exception.GetBaseException().Message)
        return
    }
    $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $ct = 'application/json; charset=utf-8'
    if ($null -ne $resp.Content.Headers.ContentType) { $ct = $resp.Content.Headers.ContentType.ToString() }
    $status = [int]$resp.StatusCode
    $resp.Dispose()
    Send-Bytes $ctx $status $ct $bytes
}

# ---------------------------------------------------------------- request routing
function Invoke-Request($ctx) {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath
    $method = $req.HttpMethod

    # Only this PC, only this app: reject foreign Host / Origin headers.
    $self = "localhost:$listenPort"
    $origin = $req.Headers['Origin']
    if ($req.UserHostName -ne $self -or (-not [string]::IsNullOrEmpty($origin) -and $origin -ne "http://$self")) {
        Send-Error $ctx 403 'Forbidden.'
        return
    }

    if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
        $html = [System.IO.File]::ReadAllText($appFile, $utf8).Replace('__FQ_TOKEN__', [string]$cfg.secret)
        Send-Text $ctx 200 'text/html; charset=utf-8' $html
        return
    }
    if ($path -eq '/api/ping') {
        Send-Text $ctx 200 'application/json; charset=utf-8' '{"app":"focusquest"}'
        return
    }
    if ($path -eq '/favicon.ico') {
        Send-Bytes $ctx 204 'image/x-icon' $null
        return
    }

    # Everything below needs the secret that is only handed to the page served above.
    if ($req.Headers['X-FQ-Token'] -ne [string]$cfg.secret) {
        Send-Error $ctx 403 'Forbidden.'
        return
    }

    if ($path -eq '/api/state' -and $method -eq 'GET') {
        Send-Json $ctx 200 @{
            jira = @{
                baseUrl  = [string]$cfg.jiraBaseUrl
                hasToken = (-not [string]::IsNullOrEmpty([string]$cfg.jiraToken))
            }
        }
        return
    }
    if ($path -eq '/api/data' -and $method -eq 'GET') {
        $data = 'null'
        if (Test-Path -LiteralPath $dataFile) {
            $data = [System.IO.File]::ReadAllText($dataFile, $utf8)
            if ([string]::IsNullOrWhiteSpace($data)) { $data = 'null' }
        }
        Send-Text $ctx 200 'application/json; charset=utf-8' $data
        return
    }
    if ($path -eq '/api/data' -and $method -eq 'PUT') {
        $body = Read-Body $req
        if (-not $body.TrimStart().StartsWith('{')) {
            Send-Error $ctx 400 'Invalid data.'
            return
        }
        Save-Data $body
        Send-Text $ctx 200 'application/json; charset=utf-8' '{"ok":true}'
        return
    }
    if ($path -eq '/api/jira-config' -and $method -eq 'POST') {
        $o = (Read-Body $req) | ConvertFrom-Json
        if ($null -ne $o.baseUrl) {
            $u = ([string]$o.baseUrl).Trim().TrimEnd('/')
            if ($u -ne '' -and $u -notmatch '^https?://') {
                Send-Error $ctx 400 'The Jira address must start with https:// or http://'
                return
            }
            $cfg.jiraBaseUrl = $u
        }
        if ($null -ne $o.token) { $cfg.jiraToken = Protect-Token (([string]$o.token).Trim()) }
        Save-Config
        Send-Text $ctx 200 'application/json; charset=utf-8' '{"ok":true}'
        return
    }
    if ($path -eq '/api/quit' -and $method -eq 'POST') {
        Send-Text $ctx 200 'application/json; charset=utf-8' '{"ok":true}'
        $script:running = $false
        return
    }
    if ($path.StartsWith('/jira/')) {
        Invoke-JiraRelay $ctx
        return
    }
    Send-Error $ctx 404 'Not found.'
}

# ---------------------------------------------------------------- start
function Test-Existing([int]$p) {
    try {
        $cts = New-Object System.Threading.CancellationTokenSource
        $cts.CancelAfter(2000)
        $r = $client.GetAsync("http://localhost:$p/api/ping", $cts.Token).GetAwaiter().GetResult()
        $t = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return ($t -like '*focusquest*')
    } catch {
        return $false
    }
}

$listener = $null
$listenPort = [int]$cfg.port
for ($i = 0; $i -lt 10; $i++) {
    $candidate = [int]$cfg.port + $i
    if (Test-Existing $candidate) {
        Write-Host "FocusQuest is already running on http://localhost:$candidate/"
        if (-not $NoBrowser) { Start-Process "http://localhost:$candidate/" }
        Start-Sleep -Seconds 2
        exit 0
    }
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$candidate/")
    try {
        $l.Start()
        $listener = $l
        $listenPort = $candidate
        break
    } catch {
        try { $l.Close() } catch { }
    }
}
if ($null -eq $listener) { throw "No free port found between $($cfg.port) and $([int]$cfg.port + 9)." }

try { $Host.UI.RawUI.WindowTitle = 'FocusQuest helper' } catch { }
Write-Host ''
Write-Host "  FocusQuest is running:  http://localhost:$listenPort/" -ForegroundColor Green
Write-Host ''
Write-Host '  Keep this window open (minimized) while you use FocusQuest.'
Write-Host '  Close it to stop FocusQuest. Your data is in the "data" folder.'
Write-Host ''

if (-not $NoBrowser) { Start-Process "http://localhost:$listenPort/" }

try {
    while ($script:running -and $listener.IsListening) {
        $task = $listener.GetContextAsync()
        while (-not $task.Wait(300)) { }
        $ctx = $task.Result
        try {
            Invoke-Request $ctx
        } catch {
            Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $_.Exception.Message) -ForegroundColor Yellow
            try { Send-Error $ctx 500 $_.Exception.Message } catch { }
            try { $ctx.Response.Abort() } catch { }
        }
    }
} finally {
    try { $listener.Stop(); $listener.Close() } catch { }
    try { $client.Dispose() } catch { }
}
