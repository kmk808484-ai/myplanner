param(
    [int]$Port = 0,
    [switch]$OpenBrowser
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webRoot = Split-Path -Parent $scriptDir
$configPath = Join-Path $scriptDir "bridge-config.json"

function Load-BridgeConfig {
    $cfg = @{
        port = 4820
        firebaseApiKey = ""
        firebaseAuthDomain = ""
        firebaseProjectId = ""
        allowedEmail = ""
        offlineFolderPath = ""
    }
    if (Test-Path -LiteralPath $configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($raw.port) { $cfg.port = [int]$raw.port }
            if ($raw.firebaseApiKey) { $cfg.firebaseApiKey = ([string]$raw.firebaseApiKey).Trim() }
            if ($raw.firebaseAuthDomain) { $cfg.firebaseAuthDomain = ([string]$raw.firebaseAuthDomain).Trim() }
            if ($raw.firebaseProjectId) { $cfg.firebaseProjectId = ([string]$raw.firebaseProjectId).Trim() }
            if ($raw.allowedEmail) { $cfg.allowedEmail = ([string]$raw.allowedEmail).Trim().ToLowerInvariant() }
            if ($raw.offlineFolderPath) { $cfg.offlineFolderPath = ([string]$raw.offlineFolderPath).Trim() }
        } catch {
            Write-Host "[경고] bridge-config.json 읽기 실패: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    return $cfg
}

$config = Load-BridgeConfig
if ($Port -gt 0) { $config.port = $Port }
$listenPort = $config.port

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$listenPort/")
$listener.Prefixes.Add("http://localhost:$listenPort/")

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "[오류] 포트 $listenPort 를 열 수 없습니다. 이미 로컬 브릿지가 실행 중일 수 있습니다." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkGray
    Read-Host "종료하려면 Enter를 누르세요"
    exit 1
}

if ($OpenBrowser) {
    Start-Process "http://localhost:$listenPort/"
}

# 검증된 Firebase ID Token 메모리 캐시 (token -> @{ email; aud; exp })
$tokenCache = @{}

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Second Brain OS - 로컬 실행 브릿지 (Firebase Auth v1.3)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  웹 접속 주소 : http://localhost:$listenPort/" -ForegroundColor Green
Write-Host "  브릿지 주소  : http://127.0.0.1:$listenPort/ (내 PC 전용)" -ForegroundColor Green
if ($config.allowedEmail -and $config.firebaseApiKey) {
    Write-Host "  인증 방식    : Firebase Google 로그인 ($($config.allowedEmail))" -ForegroundColor Yellow
} elseif ($config.firebaseApiKey) {
    Write-Host "  인증 방식    : Firebase Google 로그인 (최초 로컬 실행 시 본인 계정 자동 등록)" -ForegroundColor Yellow
} else {
    Write-Host "  인증 설정    : [미완료] bridge-config.json에 firebaseApiKey를 입력해 주세요!" -ForegroundColor Red
}
Write-Host "  종료 방법    : Ctrl + C 또는 창 닫기" -ForegroundColor DarkGray
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

function Add-CorsHeaders {
    param([System.Net.HttpListenerResponse]$Response)
    $Response.Headers["Access-Control-Allow-Origin"] = "*"
    $Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    $Response.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    $Response.Headers["Access-Control-Allow-Private-Network"] = "true"
}

function Send-JsonResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$StatusCode,
        [hashtable]$Body
    )
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json; charset=utf-8"
    Add-CorsHeaders -Response $Response

    $json = $Body | ConvertTo-Json -Depth 5 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Get-MimeType {
    param([string]$FilePath)
    switch ([System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".js"   { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".svg"  { return "image/svg+xml" }
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".ico"  { return "image/x-icon" }
        default { return "application/octet-stream" }
    }
}

function Serve-StaticFile {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [string]$RequestPath
    )
    $rel = $RequestPath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

    # local-bridge 설정 파일 및 offline-files 사용자 데이터는 정적 서빙 차단
    if ($rel -match '(^|/|\\)(local-bridge|offline-files)($|/|\\)' -or $rel -match '\.\.') {
        $Response.StatusCode = 403
        $Response.OutputStream.Close()
        return
    }

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $webRoot $rel))
    $rootFull = [System.IO.Path]::GetFullPath($webRoot)
    if (-not $fullPath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $Response.StatusCode = 403
        $Response.OutputStream.Close()
        return
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $Response.StatusCode = 404
        $Response.OutputStream.Close()
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $Response.StatusCode = 200
    $Response.ContentType = Get-MimeType -FilePath $fullPath
    $Response.Headers["Cache-Control"] = "no-cache"
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Decode-JwtPayload {
    param([string]$Jwt)
    try {
        $parts = $Jwt.Split('.')
        if ($parts.Length -ne 3) { return $null }
        $b64 = $parts[1].Replace('-', '+').Replace('_', '/')
        switch ($b64.Length % 4) {
            2 { $b64 += "==" }
            3 { $b64 += "=" }
        }
        $bytes = [Convert]::FromBase64String($b64)
        $json = [System.Text.Encoding]::UTF8.GetString($bytes)
        return ($json | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Save-BridgeConfig {
    param([hashtable]$Cfg)
    try {
        $ordered = [ordered]@{
            port               = [int]$Cfg.port
            firebaseApiKey     = [string]$Cfg.firebaseApiKey
            firebaseAuthDomain = [string]$Cfg.firebaseAuthDomain
            firebaseProjectId  = [string]$Cfg.firebaseProjectId
            allowedEmail       = [string]$Cfg.allowedEmail
            offlineFolderPath  = [string]$Cfg.offlineFolderPath
        }
        $json = $ordered | ConvertTo-Json -Depth 3
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($configPath, $json, $utf8NoBom)
    } catch {
        Write-Host "[경고] bridge-config.json 저장 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Sanitize-OfflineSegment {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return "" }
    $clean = $Name.Trim() -replace '[<>:"/\\|?*\x00-\x1f]', '_'
    $clean = $clean.TrimEnd('.', ' ')
    if ($clean -eq "." -or $clean -eq "..") { return "" }
    return $clean
}

function Get-OfflineRootPath {
    $cfg = Load-BridgeConfig
    $root = if (-not [string]::IsNullOrWhiteSpace($cfg.offlineFolderPath)) {
        $cfg.offlineFolderPath
    } else {
        Join-Path $webRoot "offline-files"
    }
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not (Test-Path -LiteralPath $rootFull)) {
        New-Item -ItemType Directory -Path $rootFull -Force | Out-Null
    }
    return $rootFull
}

function Resolve-OfflinePath {
    param(
        [string]$RootFull,
        [object[]]$FolderSegments,
        [string]$FileName = ""
    )
    $curr = $RootFull
    if ($FolderSegments) {
        foreach ($seg in $FolderSegments) {
            $safe = Sanitize-OfflineSegment -Name ([string]$seg)
            if (-not [string]::IsNullOrWhiteSpace($safe)) {
                $curr = Join-Path $curr $safe
            }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($FileName)) {
        $safeFile = Sanitize-OfflineSegment -Name $FileName
        if ([string]::IsNullOrWhiteSpace($safeFile)) { return $null }
        $curr = Join-Path $curr $safeFile
    }
    $resolved = [System.IO.Path]::GetFullPath($curr)
    $rootPrefix = $RootFull.TrimEnd('\') + '\'
    if ($resolved.Equals($RootFull.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase) -or
        $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $resolved
    }
    return $null
}

function Verify-FirebaseRequest {
    param(
        [System.Net.HttpListenerRequest]$Request
    )
    $cfg = Load-BridgeConfig

    if ([string]::IsNullOrWhiteSpace($cfg.firebaseApiKey)) {
        return @{
            ok = $false
            status = 403
            error = "local-bridge/bridge-config.json에 firebaseApiKey를 먼저 설정해 주세요."
        }
    }

    $authHeader = $Request.Headers["Authorization"]
    if ([string]::IsNullOrWhiteSpace($authHeader) -or -not $authHeader.StartsWith("Bearer ")) {
        return @{
            ok = $false
            status = 401
            error = "내 구글 계정으로 로그인해야 로컬 기능을 사용할 수 있습니다."
        }
    }

    $idToken = $authHeader.Substring(7).Trim()
    if ([string]::IsNullOrWhiteSpace($idToken)) {
        return @{
            ok = $false
            status = 401
            error = "Firebase 인증 토큰이 비어 있습니다. 다시 로그인해 주세요."
        }
    }

    $nowUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

    # 메모리 캐시 확인
    if ($tokenCache.ContainsKey($idToken)) {
        $cached = $tokenCache[$idToken]
        if ($cached.exp -gt ($nowUnix + 30)) {
            if ([string]::IsNullOrWhiteSpace($cfg.allowedEmail)) {
                $cfg.allowedEmail = $cached.email
                Save-BridgeConfig -Cfg $cfg
                Write-Host "[소유자 자동 등록] 허용 계정: $($cached.email)" -ForegroundColor Yellow
            }
            if ($cached.email -eq $cfg.allowedEmail) {
                if ([string]::IsNullOrWhiteSpace($cfg.firebaseProjectId) -or $cached.aud -eq $cfg.firebaseProjectId) {
                    return @{ ok = $true; email = $cached.email }
                }
            }
            return @{
                ok = $false
                status = 403
                error = "허용되지 않은 구글 계정($($cached.email))입니다. 허용 계정: $($cfg.allowedEmail)"
            }
        } else {
            $tokenCache.Remove($idToken)
        }
    }

    # Firebase Auth 공식 accounts:lookup API로 ID 토큰 검증
    try {
        $lookupUrl = "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=$([System.Uri]::EscapeDataString($cfg.firebaseApiKey))"
        $bodyJson = (@{ idToken = $idToken } | ConvertTo-Json -Compress)
        $res = Invoke-RestMethod -Uri $lookupUrl -Method Post -ContentType "application/json" -Body $bodyJson -TimeoutSec 8
    } catch {
        return @{
            ok = $false
            status = 401
            error = "Firebase 로그인 토큰이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요."
        }
    }

    $user = if ($res -and $res.users -and $res.users.Count -gt 0) { $res.users[0] } else { $null }
    if (-not $user) {
        return @{
            ok = $false
            status = 401
            error = "유효한 Firebase 사용자 정보를 찾을 수 없습니다."
        }
    }

    $email = ([string]$user.email).Trim().ToLowerInvariant()
    $emailVerified = [bool]$user.emailVerified
    $jwtPayload = Decode-JwtPayload -Jwt $idToken
    $aud = if ($jwtPayload -and $jwtPayload.aud) { ([string]$jwtPayload.aud).Trim() } else { "" }
    $exp = $nowUnix + 300
    if ($jwtPayload -and $jwtPayload.exp) {
        [long]::TryParse([string]$jwtPayload.exp, [ref]$exp) | Out-Null
    }

    if (-not $emailVerified -or [string]::IsNullOrWhiteSpace($email)) {
        return @{
            ok = $false
            status = 401
            error = "이메일 인증이 완료되지 않은 Google 계정입니다."
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($cfg.firebaseProjectId) -and $aud -ne $cfg.firebaseProjectId) {
        return @{
            ok = $false
            status = 403
            error = "Firebase 프로젝트 ID가 bridge-config.json 설정과 일치하지 않습니다."
        }
    }

    $tokenCache[$idToken] = @{
        email = $email
        aud = $aud
        exp = $exp
    }

    # allowedEmail이 비어 있으면 최초 인증된 본인 계정을 자동 등록
    if ([string]::IsNullOrWhiteSpace($cfg.allowedEmail)) {
        $cfg.allowedEmail = $email
        Save-BridgeConfig -Cfg $cfg
        Write-Host "[소유자 자동 등록] 허용 계정: $email" -ForegroundColor Yellow
    }

    if ($email -ne $cfg.allowedEmail) {
        Write-Host "[접근 차단] 비허용 계정: $email" -ForegroundColor Red
        return @{
            ok = $false
            status = 403
            error = "허용되지 않은 구글 계정($email)입니다. 본인 계정으로 로그인해 주세요."
        }
    }

    return @{ ok = $true; email = $email }
}

function Normalize-LocalPath {
    param([string]$RawPath)
    if ([string]::IsNullOrWhiteSpace($RawPath)) { return "" }
    $p = $RawPath.Trim()

    if (($p.StartsWith('"') -and $p.EndsWith('"')) -or ($p.StartsWith("'") -and $p.EndsWith("'"))) {
        $p = $p.Substring(1, $p.Length - 2).Trim()
    }

    if ($p -match '^file:///') {
        $p = [System.Uri]::UnescapeDataString(($p -replace '^file:///', '')).Replace('/', '\')
    }

    $p = [Environment]::ExpandEnvironmentVariables($p)
    return $p
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $method = $request.HttpMethod
        $urlPath = $request.Url.AbsolutePath

        if ($method -eq "OPTIONS") {
            $response.StatusCode = 204
            Add-CorsHeaders -Response $response
            $response.OutputStream.Close()
            continue
        }

        $trimmedPath = $urlPath.TrimEnd('/')

        if ($method -eq "GET" -and $trimmedPath -eq "/health") {
            $cfg = Load-BridgeConfig
            Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                ok = $true
                version = "1.3"
                platform = "windows"
                port = $listenPort
                authProvider = "firebase"
                authRequired = $true
                allowedEmailConfigured = (-not [string]::IsNullOrWhiteSpace($cfg.allowedEmail))
                firebaseConfigured = (-not [string]::IsNullOrWhiteSpace($cfg.firebaseApiKey))
                firebaseConfig = @{
                    apiKey = $cfg.firebaseApiKey
                    authDomain = $cfg.firebaseAuthDomain
                    projectId = $cfg.firebaseProjectId
                }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/pick-file") {
            $auth = Verify-FirebaseRequest -Request $request
            if (-not $auth.ok) {
                Send-JsonResponse -Response $response -StatusCode $auth.status -Body @{
                    ok = $false
                    error = $auth.error
                }
                continue
            }

            try {
                $form = New-Object System.Windows.Forms.Form
                $form.TopMost = $true
                $form.StartPosition = "CenterScreen"

                $dialog = New-Object System.Windows.Forms.OpenFileDialog
                $dialog.Title = "Second Brain OS에 연결할 파일 선택"
                $dialog.Filter = "모든 파일 (*.*)|*.*"
                $dialog.Multiselect = $false

                $result = $dialog.ShowDialog($form)
                $form.Dispose()

                if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.FileName) {
                    Write-Host "[파일 선택 / $($auth.email)] $($dialog.FileName)" -ForegroundColor Cyan
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $true
                        path = $dialog.FileName
                        name = [System.IO.Path]::GetFileName($dialog.FileName)
                    }
                } else {
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $false
                        cancelled = $true
                    }
                }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{
                    ok = $false
                    error = $_.Exception.Message
                }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/open") {
            $auth = Verify-FirebaseRequest -Request $request
            if (-not $auth.ok) {
                Send-JsonResponse -Response $response -StatusCode $auth.status -Body @{
                    ok = $false
                    error = $auth.error
                }
                continue
            }

            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $rawBody = $reader.ReadToEnd()
            $reader.Close()

            try {
                $payload = $rawBody | ConvertFrom-Json
            } catch {
                Send-JsonResponse -Response $response -StatusCode 400 -Body @{
                    ok = $false
                    error = "잘못된 JSON 요청입니다."
                }
                continue
            }

            $targetPath = Normalize-LocalPath -RawPath ([string]$payload.path)
            $mode = if ($payload.mode) { [string]$payload.mode } else { "open" }

            if ([string]::IsNullOrWhiteSpace($targetPath)) {
                Send-JsonResponse -Response $response -StatusCode 400 -Body @{
                    ok = $false
                    error = "실행할 경로가 비어 있습니다."
                }
                continue
            }

            try {
                $exists = Test-Path -LiteralPath $targetPath

                if ($mode -eq "reveal") {
                    if (-not $exists) {
                        Send-JsonResponse -Response $response -StatusCode 404 -Body @{
                            ok = $false
                            error = "경로를 찾을 수 없습니다: $targetPath"
                        }
                        continue
                    }
                    $resolved = (Resolve-Path -LiteralPath $targetPath).Path
                    if (Test-Path -LiteralPath $resolved -PathType Container) {
                        Start-Process -FilePath "explorer.exe" -ArgumentList "`"$resolved`""
                    } else {
                        Start-Process -FilePath "explorer.exe" -ArgumentList "/select,`"$resolved`""
                    }
                    Write-Host "[폴더 열기 / $($auth.email)] $resolved" -ForegroundColor Green
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $true
                        opened = $resolved
                    }
                    continue
                }

                if ($exists) {
                    $resolved = (Resolve-Path -LiteralPath $targetPath).Path
                    Start-Process -FilePath $resolved
                    Write-Host "[실행 성공 / $($auth.email)] $resolved" -ForegroundColor Green
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $true
                        opened = $resolved
                    }
                } elseif (Get-Command $targetPath -ErrorAction SilentlyContinue) {
                    Start-Process -FilePath $targetPath
                    Write-Host "[앱 실행 / $($auth.email)] $targetPath" -ForegroundColor Green
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $true
                        opened = $targetPath
                    }
                } else {
                    Write-Host "[실행 실패] 경로 없음: $targetPath" -ForegroundColor Red
                    Send-JsonResponse -Response $response -StatusCode 404 -Body @{
                        ok = $false
                        error = "파일 또는 폴더를 찾을 수 없습니다: $targetPath"
                    }
                }
            } catch {
                Write-Host "[실행 오류] $($_.Exception.Message)" -ForegroundColor Red
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{
                    ok = $false
                    error = $_.Exception.Message
                }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/open-content") {
            $auth = Verify-FirebaseRequest -Request $request
            if (-not $auth.ok) {
                Send-JsonResponse -Response $response -StatusCode $auth.status -Body @{
                    ok = $false
                    error = $auth.error
                }
                continue
            }

            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $rawBody = $reader.ReadToEnd()
            $reader.Close()

            try {
                $payload = $rawBody | ConvertFrom-Json
            } catch {
                Send-JsonResponse -Response $response -StatusCode 400 -Body @{
                    ok = $false
                    error = "잘못된 JSON 요청입니다."
                }
                continue
            }

            try {
                $rawName = if ($payload.fileName) { [string]$payload.fileName } else { "memo.txt" }
                $safeName = [System.IO.Path]::GetFileName($rawName).Trim()
                $safeName = $safeName -replace '[\\/:*?"<>|]', '_'
                $safeName = $safeName.Trim('. ')
                if ([string]::IsNullOrWhiteSpace($safeName)) { $safeName = "memo.txt" }
                if ($safeName.Length -gt 100) {
                    $ext = [System.IO.Path]::GetExtension($safeName)
                    $base = [System.IO.Path]::GetFileNameWithoutExtension($safeName)
                    $safeName = $base.Substring(0, [Math]::Min($base.Length, 90)) + $ext
                }
                if ([string]::IsNullOrWhiteSpace([System.IO.Path]::GetExtension($safeName))) {
                    $safeName = "$safeName.txt"
                }

                $previewDir = Join-Path ([System.IO.Path]::GetTempPath()) "SecondBrainOS-Preview"
                if (-not (Test-Path -LiteralPath $previewDir)) {
                    New-Item -ItemType Directory -Path $previewDir -Force | Out-Null
                }

                $tempPath = [System.IO.Path]::GetFullPath((Join-Path $previewDir $safeName))
                $previewDirFull = [System.IO.Path]::GetFullPath($previewDir)
                if (-not $tempPath.StartsWith($previewDirFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                    Send-JsonResponse -Response $response -StatusCode 400 -Body @{
                        ok = $false
                        error = "허용되지 않은 파일명입니다."
                    }
                    continue
                }

                $contentStr = if ($null -ne $payload.content) { [string]$payload.content } else { "" }
                $isBase64 = [bool]$payload.isBase64
                $extLower = [System.IO.Path]::GetExtension($safeName).ToLowerInvariant()
                $binaryExts = @(".pdf",".ppt",".pptx",".doc",".docx",".xls",".xlsx",".hwp",".hwpx",".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",".mp4",".mov",".avi",".mkv",".mp3",".wav",".zip",".7z",".rar",".exe",".msi")

                if ($isBase64) {
                    if ([string]::IsNullOrWhiteSpace($contentStr)) {
                        Send-JsonResponse -Response $response -StatusCode 400 -Body @{
                            ok = $false
                            error = "원본 파일 데이터가 비어 있습니다."
                        }
                        continue
                    }
                    $rawBytes = [Convert]::FromBase64String($contentStr)
                    [System.IO.File]::WriteAllBytes($tempPath, $rawBytes)
                } else {
                    if ($binaryExts -contains $extLower) {
                        Send-JsonResponse -Response $response -StatusCode 400 -Body @{
                            ok = $false
                            error = "이 항목($safeName)에는 원본 파일이 저장되어 있지 않습니다. 파일을 다시 업로드하거나 로컬 경로를 연결해 주세요."
                        }
                        continue
                    }
                    $useBom = ($extLower -eq ".csv")
                    $encoding = New-Object System.Text.UTF8Encoding($useBom)
                    [System.IO.File]::WriteAllText($tempPath, $contentStr, $encoding)
                }

                Start-Process -FilePath $tempPath
                Write-Host "[PC 앱 열기 / $($auth.email)] $safeName -> $tempPath" -ForegroundColor Green
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                    ok = $true
                    fileName = $safeName
                    path = $tempPath
                }
            } catch {
                Write-Host "[PC 앱 열기 오류] $($_.Exception.Message)" -ForegroundColor Red
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{
                    ok = $false
                    error = $_.Exception.Message
                }
            }
            continue
        }

        # ================= Offline Local Folder Sync Routes (Loopback Only) =================
        if ($method -eq "GET" -and $trimmedPath -eq "/offline-fs/status") {
            try {
                $offlineRoot = Get-OfflineRootPath
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                    ok = $true
                    folderPath = $offlineRoot
                    folderName = [System.IO.Path]::GetFileName($offlineRoot.TrimEnd('\'))
                }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{
                    ok = $false
                    error = $_.Exception.Message
                }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/offline-fs/pick-folder") {
            try {
                $form = New-Object System.Windows.Forms.Form
                $form.TopMost = $true
                $form.StartPosition = "CenterScreen"

                $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
                $dlg.Description = "오프라인 파일을 자동 저장할 로컬 폴더를 선택하세요"
                $dlg.SelectedPath = Get-OfflineRootPath
                $dlg.ShowNewFolderButton = $true

                $resDlg = $dlg.ShowDialog($form)
                $form.Dispose()

                if ($resDlg -eq [System.Windows.Forms.DialogResult]::OK -and $dlg.SelectedPath) {
                    $picked = [System.IO.Path]::GetFullPath($dlg.SelectedPath)
                    $cfg = Load-BridgeConfig
                    $cfg.offlineFolderPath = $picked
                    Save-BridgeConfig -Cfg $cfg
                    Write-Host "[오프라인 저장 폴더 변경] $picked" -ForegroundColor Cyan
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $true
                        folderPath = $picked
                        folderName = [System.IO.Path]::GetFileName($picked.TrimEnd('\'))
                    }
                } else {
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                        ok = $false
                        cancelled = $true
                    }
                }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{
                    ok = $false
                    error = $_.Exception.Message
                }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/offline-fs/mkdir") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $rawBody = $reader.ReadToEnd()
            $reader.Close()
            try {
                $payload = $rawBody | ConvertFrom-Json
                $offlineRoot = Get-OfflineRootPath
                $targetDir = Resolve-OfflinePath -RootFull $offlineRoot -FolderSegments $payload.folderPath
                if (-not $targetDir) {
                    Send-JsonResponse -Response $response -StatusCode 400 -Body @{ ok = $false; error = "허용되지 않은 폴더 경로입니다." }
                    continue
                }
                if (-not (Test-Path -LiteralPath $targetDir)) {
                    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
                }
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{ ok = $true; path = $targetDir }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{ ok = $false; error = $_.Exception.Message }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/offline-fs/write") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $rawBody = $reader.ReadToEnd()
            $reader.Close()
            try {
                $payload = $rawBody | ConvertFrom-Json
                $offlineRoot = Get-OfflineRootPath
                $targetFile = Resolve-OfflinePath -RootFull $offlineRoot -FolderSegments $payload.folderPath -FileName ([string]$payload.fileName)
                if (-not $targetFile) {
                    Send-JsonResponse -Response $response -StatusCode 400 -Body @{ ok = $false; error = "허용되지 않은 파일 경로입니다." }
                    continue
                }
                if ([bool]$payload.onlyIfMissing -and (Test-Path -LiteralPath $targetFile)) {
                    Send-JsonResponse -Response $response -StatusCode 200 -Body @{ ok = $true; skipped = $true; path = $targetFile }
                    continue
                }
                $parentDir = Split-Path -Parent $targetFile
                if (-not (Test-Path -LiteralPath $parentDir)) {
                    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
                }
                $contentStr = if ($null -ne $payload.content) { [string]$payload.content } else { "" }
                if ([bool]$payload.isBase64) {
                    $rawBytes = [Convert]::FromBase64String($contentStr)
                    [System.IO.File]::WriteAllBytes($targetFile, $rawBytes)
                } else {
                    $extLower = [System.IO.Path]::GetExtension($targetFile).ToLowerInvariant()
                    $useBom = ($extLower -eq ".csv")
                    $enc = New-Object System.Text.UTF8Encoding($useBom)
                    [System.IO.File]::WriteAllText($targetFile, $contentStr, $enc)
                }
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{ ok = $true; path = $targetFile }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{ ok = $false; error = $_.Exception.Message }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/offline-fs/delete") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $rawBody = $reader.ReadToEnd()
            $reader.Close()
            try {
                $payload = $rawBody | ConvertFrom-Json
                $offlineRoot = Get-OfflineRootPath
                $targetPath = Resolve-OfflinePath -RootFull $offlineRoot -FolderSegments $payload.folderPath -FileName ([string]$payload.name)
                if (-not $targetPath -or $targetPath.Equals($offlineRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
                    Send-JsonResponse -Response $response -StatusCode 400 -Body @{ ok = $false; error = "허용되지 않은 삭제 경로입니다." }
                    continue
                }
                if (Test-Path -LiteralPath $targetPath) {
                    Remove-Item -LiteralPath $targetPath -Recurse -Force
                }
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{ ok = $true }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{ ok = $false; error = $_.Exception.Message }
            }
            continue
        }

        if ($method -eq "POST" -and $trimmedPath -eq "/offline-fs/rename") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $rawBody = $reader.ReadToEnd()
            $reader.Close()
            try {
                $payload = $rawBody | ConvertFrom-Json
                $offlineRoot = Get-OfflineRootPath
                $oldPath = Resolve-OfflinePath -RootFull $offlineRoot -FolderSegments $payload.oldFolderPath -FileName ([string]$payload.oldName)
                $newPath = Resolve-OfflinePath -RootFull $offlineRoot -FolderSegments $payload.newFolderPath -FileName ([string]$payload.newName)
                if (-not $oldPath -or -not $newPath) {
                    Send-JsonResponse -Response $response -StatusCode 400 -Body @{ ok = $false; error = "허용되지 않은 경로입니다." }
                    continue
                }
                if (Test-Path -LiteralPath $oldPath) {
                    $newParent = Split-Path -Parent $newPath
                    if (-not (Test-Path -LiteralPath $newParent)) {
                        New-Item -ItemType Directory -Path $newParent -Force | Out-Null
                    }
                    if ($oldPath -ne $newPath) {
                        Move-Item -LiteralPath $oldPath -Destination $newPath -Force
                    }
                }
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{ ok = $true; path = $newPath }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{ ok = $false; error = $_.Exception.Message }
            }
            continue
        }

        if ($method -eq "GET" -and $trimmedPath -eq "/offline-fs/list") {
            try {
                $offlineRoot = Get-OfflineRootPath
                $rootLen = $offlineRoot.TrimEnd('\').Length
                $foldersOut = @()
                $filesOut = @()
                $textExts = @(".md",".txt",".html",".htm",".css",".js",".ts",".json",".csv",".xml",".yml",".yaml",".py",".c",".cpp",".java")

                $items = Get-ChildItem -LiteralPath $offlineRoot -Recurse -Force -ErrorAction SilentlyContinue
                foreach ($it in $items) {
                    if ($it.Name.StartsWith('.')) { continue }
                    $rel = $it.FullName.Substring($rootLen).TrimStart('\')
                    if ([string]::IsNullOrWhiteSpace($rel)) { continue }
                    $parts = $rel.Split('\')
                    if ($parts | Where-Object { $_.StartsWith('.') }) { continue }
                    if ($it.PSIsContainer) {
                        $foldersOut += ,$parts
                    } else {
                        $fPath = if ($parts.Length -gt 1) { $parts[0..($parts.Length - 2)] } else { @() }
                        $extL = [System.IO.Path]::GetExtension($it.Name).ToLowerInvariant()
                        $entryObj = @{
                            name = $it.Name
                            folderPath = $fPath
                            size = $it.Length
                            lastModified = [DateTimeOffset]::new($it.LastWriteTimeUtc).ToUnixTimeMilliseconds()
                        }
                        if (($textExts -contains $extL) -and $it.Length -le 512000) {
                            $entryObj.textContent = [System.IO.File]::ReadAllText($it.FullName, [System.Text.Encoding]::UTF8)
                        } elseif (($extL -eq ".xlsx" -or $extL -eq ".xls") -and $it.Length -le 10485760) {
                            $entryObj.base64Content = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($it.FullName))
                        }
                        $filesOut += $entryObj
                    }
                }
                Send-JsonResponse -Response $response -StatusCode 200 -Body @{
                    ok = $true
                    folderPath = $offlineRoot
                    folders = $foldersOut
                    files = $filesOut
                }
            } catch {
                Send-JsonResponse -Response $response -StatusCode 500 -Body @{ ok = $false; error = $_.Exception.Message }
            }
            continue
        }

        if ($method -eq "GET") {
            Serve-StaticFile -Response $response -RequestPath $urlPath
            continue
        }

        Send-JsonResponse -Response $response -StatusCode 404 -Body @{
            ok = $false
            error = "지원하지 않는 요청입니다."
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
