param([switch]$Setup, [switch]$Update)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $projectDirectory '.local\scanner'
$databaseDirectory = Join-Path $runtimeDirectory 'database'
$version = '1.5.5'
$archivePath = Join-Path $projectDirectory ".local\downloads\clamav-$version.win.x64.zip"
$binaryDirectory = Join-Path $projectDirectory ".local\tools\clamav-$version\clamav-$version.win.x64"
$clamExecutable = Join-Path $binaryDirectory 'clamd.exe'
$updaterExecutable = Join-Path $binaryDirectory 'freshclam.exe'
$clamConfiguration = Join-Path $runtimeDirectory 'clamd.conf'
$updateConfiguration = Join-Path $runtimeDirectory 'freshclam.conf'

if ($Setup) {
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This portable setup requires Windows x64.' }
    New-Item -ItemType Directory -Path (Split-Path $archivePath), (Split-Path $binaryDirectory), $databaseDirectory -Force | Out-Null
    if (-not (Test-Path -LiteralPath $archivePath)) {
        & curl.exe --fail --location --retry 2 --silent --show-error --output $archivePath "https://www.clamav.net/downloads/production/clamav-$version.win.x64.zip"
        if ($LASTEXITCODE -ne 0) { throw 'Official ClamAV download failed.' }
    }
    $expectedHash = '90169F5E551010BFBD0208B50D9B2FA8988EF396CCCBD46B0CC8CAE03E22A4A4'
    if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'The pinned ClamAV archive hash does not match. Do not run this download.'
    }
    if (-not (Test-Path -LiteralPath $clamExecutable)) {
        Expand-Archive -LiteralPath $archivePath -DestinationPath (Split-Path $binaryDirectory) -Force
    }
    $clamConfig = @"
TCPSocket 3310
TCPAddr 127.0.0.1
DatabaseDirectory "$databaseDirectory"
LogFile "$runtimeDirectory\clamd.log"
LogTime yes
LogFileMaxSize 5M
PidFile "$runtimeDirectory\clamd.pid"
Foreground yes
StreamMaxLength 6M
MaxFileSize 6M
MaxScanSize 30M
MaxRecursion 16
MaxThreads 2
SelfCheck 300
FailIfCvdOlderThan 7
ReadTimeout 30
CommandReadTimeout 10
AlertExceedsMax yes
AlertEncrypted yes
"@
    $freshConfig = @"
DatabaseDirectory "$databaseDirectory"
DatabaseMirror database.clamav.net
UpdateLogFile "$runtimeDirectory\freshclam.log"
LogTime yes
LogFileMaxSize 5M
Checks 4
Foreground yes
"@
    [IO.File]::WriteAllText($clamConfiguration, $clamConfig, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($updateConfiguration, $freshConfig, [Text.UTF8Encoding]::new($false))
}
if (-not (Test-Path -LiteralPath $clamConfiguration)) { throw 'Run this script with -Setup first.' }
if ($Setup -or $Update) {
    & $updaterExecutable "--config-file=$updateConfiguration" --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Signature update failed. File transfers remain unavailable.' }
}

function Start-LocalScannerProcess($executable, $arguments, $pidPath, $logName) {
    if (Test-Path -LiteralPath $pidPath) {
        $savedProcessId = 0
        if ([int]::TryParse(([IO.File]::ReadAllText($pidPath)).Trim(), [ref]$savedProcessId)) {
            $existing = Get-Process -Id $savedProcessId -ErrorAction SilentlyContinue
            if ($existing -and $existing.Path -eq $executable) { return }
        }
    }
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $binaryDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory "$logName.stdout.log") -RedirectStandardError (Join-Path $runtimeDirectory "$logName.stderr.log") -PassThru
    [IO.File]::WriteAllText($pidPath, [string]$process.Id)
}

Start-LocalScannerProcess $clamExecutable @("--config-file=`"$clamConfiguration`"") (Join-Path $runtimeDirectory 'clamd.pid') 'clamd'
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $client.ReceiveTimeout = 1000
        $client.SendTimeout = 1000
        $client.Connect('127.0.0.1', 3310)
        $stream = $client.GetStream()
        $ping = [Text.Encoding]::ASCII.GetBytes("zPING$([char]0)")
        $stream.Write($ping, 0, $ping.Length)
        $buffer = [byte[]]::new(32)
        $length = $stream.Read($buffer, 0, $buffer.Length)
        $ready = ([Text.Encoding]::ASCII.GetString($buffer, 0, $length)).StartsWith('PONG')
    } catch { $ready = $false } finally { $client.Dispose() }
    if ($ready) { break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'ClamAV did not become ready. Check the logs under .local/scanner.' }
$python = Join-Path $projectDirectory 'backend\.venv\Scripts\python.exe'
$previousHost, $previousPort = $env:FILE_SCAN_HOST, $env:FILE_SCAN_PORT
try {
    $env:FILE_SCAN_HOST, $env:FILE_SCAN_PORT = '127.0.0.1', '3310'
    & $python (Join-Path $projectDirectory 'backend\manage.py') check_file_scanner
    if ($LASTEXITCODE -ne 0) { throw 'Scanner verification failed; the application configuration has not changed.' }
} finally { $env:FILE_SCAN_HOST, $env:FILE_SCAN_PORT = $previousHost, $previousPort }

Start-LocalScannerProcess $updaterExecutable @('--daemon', "--config-file=`"$updateConfiguration`"") (Join-Path $runtimeDirectory 'freshclam.process.pid') 'freshclam'
$envPath = Join-Path $projectDirectory '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Create your local .env from .env.example first.' }
$content = [IO.File]::ReadAllText($envPath)
foreach ($setting in @(@('FILE_SCAN_HOST', '127.0.0.1'), @('FILE_SCAN_PORT', '3310'))) {
    $pattern = '(?m)^' + $setting[0] + '=.*$'
    $line = $setting[0] + '=' + $setting[1]
    if ([regex]::IsMatch($content, $pattern)) { $content = [regex]::Replace($content, $pattern, $line) }
    else { $content = $content.TrimEnd() + "`r`n$line`r`n" }
}
[IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
Write-Output 'File scanning configured. Restart the backend to load .env. Run this script after restarting Windows; no system service was installed.'
