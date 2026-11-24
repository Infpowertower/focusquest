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
$versionFile = Join-Path $root 'version.txt'
$utf8     = New-Object System.Text.UTF8Encoding($false)
$script:lastBackupDay = ''
$script:running = $true
$script:restart = $false
# When this PC session began: the start of the helper, or the last time the PC woke up from sleep.
# The page uses it to end a period of working time that was cut off and to start a new one.
$script:awakeSince = [DateTime]::UtcNow
$script:lastTick = [DateTime]::UtcNow
$script:update = $null

# Updates come from the releases of this GitHub repository and from nowhere else.
# This is a constant on purpose: neither the page nor the data file can change it.
$updateRepo  = 'Infpowertower/focusquest'
$updateApi   = "https://api.github.com/repos/$updateRepo/releases/latest"
$updateFrom  = "https://github.com/$updateRepo/releases/download/"
$updateFiles = @('app.html', 'server.ps1', 'Start-FocusQuest.cmd', 'README.txt', 'LICENSE.txt', 'version.txt')
$updateNeeds = @('app.html', 'server.ps1', 'Start-FocusQuest.cmd', 'version.txt')
# For the automated tests only: a stand-in for GitHub on this PC.
$updateTest = $false
if ([string]$env:FOCUSQUEST_UPDATE_API -match '^http://localhost:\d+/') {
    $updateApi = [string]$env:FOCUSQUEST_UPDATE_API
    $updateTest = $true
}

function ConvertTo-Ver([string]$s) {
    $s = $s.Trim()
    if ($s.StartsWith('v')) { $s = $s.Substring(1) }
    if ($s -notmatch '^\d+(\.\d+){1,3}$') { return $null }
    return [version]$s
}

# A copy without version.txt is the first version that was handed out as a plain zip file.
$version = '1.0.0'
if (Test-Path -LiteralPath $versionFile) {
    $v = ConvertTo-Ver ([System.IO.File]::ReadAllText($versionFile))
    if ($null -ne $v) { $version = $v.ToString() }
}

if (-not (Test-Path -LiteralPath $appFile)) { throw "app.html is missing. It must be in the same folder as server.ps1 ($root)." }
if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
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
    updateCache    = ''
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
$basePort = [int]$cfg.port
if ($Port -gt 0) { $basePort = $Port }

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

# ---------------------------------------------------------------- http client for GitHub (update check and download)
# A separate client: it follows redirects and never carries the Jira token.
$ghHandler = New-Object System.Net.Http.HttpClientHandler
$ghHandler.AllowAutoRedirect = $true
$ghHandler.UseCookies = $false
$ghHandler.UseProxy = [bool]$cfg.useSystemProxy
# A company proxy that asks for the Windows sign-in gets it, as it does from the browser.
try { $ghHandler.DefaultProxyCredentials = [System.Net.CredentialCache]::DefaultCredentials } catch { }
$ghHandler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
$ghClient = New-Object System.Net.Http.HttpClient($ghHandler)
$ghClient.Timeout = [TimeSpan]::FromSeconds(60)
$ghClient.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent', "FocusQuest/$version") | Out-Null

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

# ---------------------------------------------------------------- start with Windows
# A shortcut in the Startup folder of this Windows user. No admin rights, no registry.
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'FocusQuest.lnk'
function Set-Autostart([bool]$on) {
    if (-not $on) {
        if (Test-Path -LiteralPath $startupLink) { Remove-Item -LiteralPath $startupLink -Force }
        return
    }
    $dir = Split-Path -Parent $startupLink
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($startupLink)
    $sc.TargetPath = (Join-Path $root 'Start-FocusQuest.cmd')
    $sc.WorkingDirectory = $root
    $sc.WindowStyle = 7
    $sc.Description = 'Starts FocusQuest when you sign in'
    $sc.Save()
}

# The helper looks at the clock a few times per second. A jump of minutes means the PC was asleep.
function Update-Awake {
    $now = [DateTime]::UtcNow
    if (($now - $script:lastTick).TotalSeconds -gt 180) { $script:awakeSince = $now }
    $script:lastTick = $now
}

# ---------------------------------------------------------------- updates
function New-UpdateInfo {
    return @{ at = [DateTime]::UtcNow; ok = $false; latest = ''; notes = ''; publishedAt = ''; zipUrl = ''; shaUrl = ''; message = '' }
}

# The last successful check is remembered across restarts, so GitHub is asked once a day at most.
if (-not [string]::IsNullOrEmpty([string]$cfg.updateCache)) {
    try {
        $c = ([string]$cfg.updateCache) | ConvertFrom-Json
        $u = New-UpdateInfo
        $u.at = [DateTime]::Parse([string]$c.at, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        $u.ok = $true
        $u.latest = [string]$c.latest
        $u.notes = [string]$c.notes
        $u.publishedAt = [string]$c.publishedAt
        if ($u.latest -eq '' -or $null -ne (ConvertTo-Ver $u.latest)) { $script:update = $u }
    } catch {
        $script:update = $null
    }
}

# Asks GitHub for the newest release (GitHub leaves out drafts and pre-releases here).
function Request-Release {
    $info = New-UpdateInfo
    try {
        $msg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $updateApi)
        $msg.Headers.TryAddWithoutValidation('Accept', 'application/vnd.github+json') | Out-Null
        $resp = $ghClient.SendAsync($msg).GetAwaiter().GetResult()
        $status = [int]$resp.StatusCode
        $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $resp.Dispose()
        if ($status -eq 200) {
            $rel = $text | ConvertFrom-Json
            $ver = ConvertTo-Ver ([string]$rel.tag_name)
            if ($null -eq $ver -or $rel.draft -eq $true -or $rel.prerelease -eq $true) {
                $info.message = 'The newest release on GitHub is not a regular version.'
            } else {
                $info.latest = $ver.ToString()
                $notes = [string]$rel.body
                if ($notes.Length -gt 20000) { $notes = $notes.Substring(0, 20000) }
                $info.notes = $notes
                $info.publishedAt = [string]$rel.published_at
                $zipName = "FocusQuest-$($info.latest).zip"
                foreach ($a in @($rel.assets)) {
                    if ([string]$a.name -eq $zipName) { $info.zipUrl = [string]$a.browser_download_url }
                    if ([string]$a.name -eq "$zipName.sha256") { $info.shaUrl = [string]$a.browser_download_url }
                }
                $info.ok = $true
            }
        } elseif ($status -eq 404) {
            $info.ok = $true   # no release published yet
        } elseif ($status -eq 403 -or $status -eq 429) {
            $info.message = 'GitHub is not answering update checks from this network right now. Try again later.'
        } else {
            $info.message = "GitHub answered the update check with status $status."
        }
    } catch {
        $info.message = 'GitHub could not be reached: ' + $_.Exception.GetBaseException().Message
    }
    $script:update = $info
    if ($info.ok) {
        try {
            $cfg.updateCache = (@{ at = $info.at.ToString('o'); latest = $info.latest; notes = $info.notes; publishedAt = $info.publishedAt } | ConvertTo-Json -Compress)
            Save-Config
        } catch { }
    }
    return $info
}

function Get-UpdateInfo([bool]$force) {
    if (-not $force -and $null -ne $script:update) {
        $age = ([DateTime]::UtcNow - $script:update.at).TotalHours
        # a good answer is kept for a day, a failed check is repeated after an hour at the earliest
        if ($age -ge 0 -and (($script:update.ok -and $age -lt 24) -or (-not $script:update.ok -and $age -lt 1))) { return $script:update }
    }
    return (Request-Release)
}

function Get-UpdateView($info) {
    $available = $false
    if ($info.ok -and $info.latest -ne '') {
        $new = ConvertTo-Ver $info.latest
        $cur = ConvertTo-Ver $version
        if ($null -ne $new -and $null -ne $cur) { $available = ($new -gt $cur) }
    }
    return @{
        current     = $version
        latest      = [string]$info.latest
        available   = $available
        notes       = [string]$info.notes
        publishedAt = [string]$info.publishedAt
        ok          = [bool]$info.ok
        message     = [string]$info.message
        checkedAt   = $info.at.ToString('o')
    }
}

function Test-UpdateUrl([string]$url) {
    if ($updateTest) { return ($url -match '^http://localhost:\d+/') }
    return $url.StartsWith($updateFrom, [System.StringComparison]::OrdinalIgnoreCase)
}

function Save-Download([string]$url, [string]$file, [int]$maxBytes) {
    $msg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $url)
    $msg.Headers.TryAddWithoutValidation('Accept', 'application/octet-stream') | Out-Null
    $resp = $ghClient.SendAsync($msg, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    try {
        if ([int]$resp.StatusCode -ne 200) { throw "The download failed with status $([int]$resp.StatusCode)." }
        # GitHub redirects downloads to its file servers. Wherever it ends, it has to be https.
        if (-not $updateTest -and $resp.RequestMessage.RequestUri.Scheme -ne 'https') { throw 'The download was redirected to an address without https.' }
        $src = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $dst = [System.IO.File]::Create($file)
        try {
            $buf = New-Object byte[] 65536
            $total = 0
            while ($true) {
                $n = $src.Read($buf, 0, $buf.Length)
                if ($n -le 0) { break }
                $total += $n
                if ($total -gt $maxBytes) { throw 'The download is larger than expected.' }
                $dst.Write($buf, 0, $n)
            }
        } finally {
            $dst.Close()
            $src.Close()
        }
    } finally {
        $resp.Dispose()
    }
}

# Downloads the release, checks it and replaces the program files. The data folder is never touched.
# Throws with a message for the user when anything is wrong; in that case the installed version is unchanged.
function Install-Update($info) {
    if ([string]::IsNullOrEmpty($info.zipUrl) -or [string]::IsNullOrEmpty($info.shaUrl)) {
        throw 'The release on GitHub has no download yet. Try again in a few minutes.'
    }
    if (-not (Test-UpdateUrl $info.zipUrl) -or -not (Test-UpdateUrl $info.shaUrl)) {
        throw 'The release points to an unexpected download address.'
    }
    $upd = Join-Path $dataDir 'update'
    $staged = Join-Path $upd 'staged'
    $prev = Join-Path $upd 'previous'
    $zip = Join-Path $upd 'update.zip'
    $sha = Join-Path $upd 'update.zip.sha256'
    if (-not (Test-Path -LiteralPath $upd)) { New-Item -ItemType Directory -Path $upd | Out-Null }
    if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Recurse -Force }
    New-Item -ItemType Directory -Path $staged | Out-Null

    Save-Download $info.zipUrl $zip 20971520
    Save-Download $info.shaUrl $sha 4096
    $want = (([System.IO.File]::ReadAllText($sha)).Trim() -split '\s+')[0]
    if ($want -notmatch '^[0-9a-fA-F]{64}$') { throw 'The checksum file of the release cannot be read.' }
    $have = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if ($have -ne $want) { throw 'The download does not match its checksum.' }

    # Only these file names are taken out of the archive, each to a fixed place.
    # Whatever else the archive contains, under whatever path, is never written to disk.
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($name in $updateFiles) {
            $entry = $archive.GetEntry("FocusQuest/$name")
            if ($null -eq $entry) { continue }
            if ($entry.Length -gt 10485760) { throw "$name in the download is larger than expected." }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $staged $name), $true)
        }
    } finally {
        $archive.Dispose()
    }

    foreach ($name in $updateNeeds) {
        if (-not (Test-Path -LiteralPath (Join-Path $staged $name))) { throw "The download is incomplete: $name is missing." }
    }
    $newVer = ConvertTo-Ver ([System.IO.File]::ReadAllText((Join-Path $staged 'version.txt')))
    if ($null -eq $newVer -or $newVer.ToString() -ne $info.latest) { throw 'The download is not the version GitHub announced.' }
    if (-not ([System.IO.File]::ReadAllText((Join-Path $staged 'app.html'), $utf8)).Contains('__FQ_TOKEN__')) { throw 'app.html in the download is not a FocusQuest page.' }
    $tokens = $null
    $syntax = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $staged 'server.ps1'), [ref]$tokens, [ref]$syntax) | Out-Null
    if ($null -ne $syntax -and $syntax.Count -gt 0) { throw 'server.ps1 in the download has syntax errors.' }

    # A copy of the data as it was before this update. The last five are kept.
    if (Test-Path -LiteralPath $dataFile) {
        $bdir = Join-Path $dataDir 'backups'
        if (-not (Test-Path -LiteralPath $bdir)) { New-Item -ItemType Directory -Path $bdir | Out-Null }
        [System.IO.File]::Copy($dataFile, (Join-Path $bdir "pre-update-$version.json"), $true)
        $old = Get-ChildItem -LiteralPath $bdir -Filter 'pre-update-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 5
        foreach ($f in $old) { try { [System.IO.File]::Delete($f.FullName) } catch { } }
    }

    # The program files as they are now, to go back to if the copy below fails (or by hand later).
    if (Test-Path -LiteralPath $prev) { Remove-Item -LiteralPath $prev -Recurse -Force }
    New-Item -ItemType Directory -Path $prev | Out-Null
    $had = @()
    foreach ($name in $updateFiles) {
        $cur = Join-Path $root $name
        if (Test-Path -LiteralPath $cur) {
            [System.IO.File]::Copy($cur, (Join-Path $prev $name), $true)
            $had += $name
        }
    }

    try {
        foreach ($name in $updateFiles) {
            $new = Join-Path $staged $name
            if (Test-Path -LiteralPath $new) { [System.IO.File]::Copy($new, (Join-Path $root $name), $true) }
        }
    } catch {
        $why = $_.Exception.GetBaseException().Message
        foreach ($name in $had) {
            try { [System.IO.File]::Copy((Join-Path $prev $name), (Join-Path $root $name), $true) } catch { }
        }
        throw "The new files could not be written ($why) The previous version was put back."
    }

    try {
        Remove-Item -LiteralPath $staged -Recurse -Force
        Remove-Item -LiteralPath $zip -Force
        Remove-Item -LiteralPath $sha -Force
    } catch { }
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
            version = $version
            awakeSince = $script:awakeSince.ToString('o')
            autostart = (Test-Path -LiteralPath $startupLink)
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
    if ($path -eq '/api/autostart' -and $method -eq 'POST') {
        $o = (Read-Body $req) | ConvertFrom-Json
        Set-Autostart ($o.enabled -eq $true)
        Send-Json $ctx 200 @{ ok = $true; autostart = (Test-Path -LiteralPath $startupLink) }
        return
    }
    if ($path -eq '/api/update/check' -and $method -eq 'GET') {
        $info = Get-UpdateInfo ($req.Url.Query -match 'force=1')
        Send-Json $ctx 200 (Get-UpdateView $info)
        return
    }
    if ($path -eq '/api/update/apply' -and $method -eq 'POST') {
        # What gets installed is decided here from GitHub's answer, never by the request.
        $info = Request-Release
        if (-not $info.ok) {
            Send-Error $ctx 502 $info.message
            return
        }
        if (-not (Get-UpdateView $info).available) {
            Send-Error $ctx 409 'FocusQuest is already up to date.'
            return
        }
        try {
            Install-Update $info | Out-Null
        } catch {
            Send-Error $ctx 500 ('The update was not installed. ' + $_.Exception.GetBaseException().Message)
            return
        }
        Send-Json $ctx 200 @{ ok = $true; restarting = $true; version = $info.latest }
        $script:restart = $true
        $script:running = $false
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
$listenPort = $basePort
for ($i = 0; $i -lt 10; $i++) {
    $candidate = $basePort + $i
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
if ($null -eq $listener) { throw "No free port found between $basePort and $($basePort + 9)." }

try { $Host.UI.RawUI.WindowTitle = 'FocusQuest helper' } catch { }
Write-Host ''
Write-Host "  FocusQuest $version is running:  http://localhost:$listenPort/" -ForegroundColor Green
Write-Host ''
Write-Host '  Keep this window open (minimized) while you use FocusQuest.'
Write-Host '  Close it to stop FocusQuest. Your data is in the "data" folder.'
Write-Host ''

if (-not $NoBrowser) { Start-Process "http://localhost:$listenPort/" }

try {
    while ($script:running -and $listener.IsListening) {
        $task = $listener.GetContextAsync()
        while (-not $task.Wait(300)) { Update-Awake }
        Update-Awake
        $ctx = $task.Result
        try {
            Invoke-Request $ctx
            $script:lastTick = [DateTime]::UtcNow   # a long request (download, slow Jira) is not sleep
        } catch {
            Write-Host ((Get-Date).ToString('HH:mm:ss') + '  ' + $_.Exception.Message) -ForegroundColor Yellow
            try { Send-Error $ctx 500 $_.Exception.Message } catch { }
            try { $ctx.Response.Abort() } catch { }
        }
    }
} finally {
    try { $listener.Stop(); $listener.Close() } catch { }
    try { $client.Dispose() } catch { }
    try { $ghClient.Dispose() } catch { }
}

# After an update: the listener above is closed, now the new version takes over the same address.
if ($script:restart) {
    Write-Host ''
    Write-Host '  Update installed. Starting the new version ...'
    $exe = (Get-Process -Id $PID).Path
    $self = $MyInvocation.MyCommand.Path
    Start-Process -FilePath $exe -WindowStyle Minimized -ArgumentList "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$self`" -NoBrowser -Port $listenPort"
}
