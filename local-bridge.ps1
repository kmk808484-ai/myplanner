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
    }
    if (Test-Path -LiteralPath $configPath) {
        try {
            $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($raw.port) { $cfg.port = [int]$raw.port }
            if ($raw.firebaseApiKey) { $cfg.firebaseApiKey = ([string]$raw.firebaseApiKey).Trim() }
            if ($raw.firebaseAuthDomain) { $cfg.firebaseAuthDomain = ([string]$raw.firebaseAuthDomain).Trim() }
            if ($raw.firebaseProjectId) { $cfg.firebaseProjectId = ([string]$raw.firebaseProjectId).Trim() }
            if ($raw.allowedEmail) { $cfg.allowedEmail = ([string]$raw.allowedEmail).Trim().ToLowerInvariant() }
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
Write-Host "  Second Brain OS - 로컬 실행 브릿지 (Firebase Auth v1.2)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  웹 접속 주소 : http://localhost:$listenPort/" -ForegroundColor Green
Write-Host "  브릿지 주소  : http://127.0.0.1:$listenPort/ (내 PC 전용)" -ForegroundColor Green
if ($config.allowedEmail -and $config.firebaseApiKey) {
    Write-Host "  인증 방식    : Firebase Google 로그인 ($($config.allowedEmail))" -ForegroundColor Yellow
} else {
    Write-Host "  인증 설정    : [미완료] bridge-config.json에 firebaseApiKey와 allowedEmail을 입력해 주세요!" -ForegroundColor Red
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
        ".html"  { return "text/html; charset=utf-8" }
        ".htm"   { return "text/html; charset=utf-8" }
        ".css"   { return "text/css; charset=utf-8" }
        ".js"    { return "application/javascript; charset=utf-8" }
        ".mjs"   { return "application/javascript; charset=utf-8" }
        ".json"  { return "application/json; charset=utf-8" }
        ".wasm"  { return "application/wasm" }
        ".gz"    { return "application/octet-stream" }
        ".bcmap" { return "application/octet-stream" }
        ".svg"   { return "image/svg+xml" }
        ".png"   { return "image/png" }
        ".jpg"   { return "image/jpeg" }
        ".jpeg"  { return "image/jpeg" }
        ".webp"  { return "image/webp" }
        ".ico"   { return "image/x-icon" }
        default  { return "application/octet-stream" }
    }
}

function Serve-StaticFile {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [string]$RequestPath,
        [bool]$HeadOnly = $false
    )
    $rel = [System.Uri]::UnescapeDataString($RequestPath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

    # local-bridge 설정 파일 등은 외부 정적 서빙 차단
    if ($rel -match '(^|/|\\)local-bridge($|/|\\)' -or $rel -match '\.\.') {
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

    if (Test-Path -LiteralPath $fullPath -PathType Container) {
        $fullPath = Join-Path $fullPath "index.html"
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $Response.StatusCode = 404
        $Response.OutputStream.Close()
        return
    }

    try {
        $Response.StatusCode = 200
        $Response.ContentType = Get-MimeType -FilePath $fullPath
        $Response.Headers["Cache-Control"] = "no-cache"
        if ($HeadOnly) {
            $fi = New-Object System.IO.FileInfo($fullPath)
            $Response.ContentLength64 = $fi.Length
            $Response.OutputStream.Close()
            return
        }
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $Response.ContentLength64 = $bytes.Length
        $Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $Response.OutputStream.Close()
    } catch {
        # 클라이언트가 대용량 파일 전송 중 연결을 끊은 경우(Abort/Timeout) 서버 종료 방지
        try { $Response.Abort() } catch {}
    }
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

function Verify-FirebaseRequest {
    param(
        [System.Net.HttpListenerRequest]$Request
    )
    $cfg = Load-BridgeConfig

    if ([string]::IsNullOrWhiteSpace($cfg.allowedEmail) -or [string]::IsNullOrWhiteSpace($cfg.firebaseApiKey)) {
        return @{
            ok = $false
            status = 403
            error = "local-bridge/bridge-config.json에 firebaseApiKey와 allowedEmail(내 구글 이메일)을 먼저 설정해 주세요."
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
                version = "1.2"
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

        if ($method -eq "GET" -or $method -eq "HEAD") {
            Serve-StaticFile -Response $response -RequestPath $urlPath -HeadOnly ($method -eq "HEAD")
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
