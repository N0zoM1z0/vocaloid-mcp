param(
    [Parameter(Mandatory = $true)]
    [string]$HelperPath,

    [Parameter(Mandatory = $true)]
    [string]$EditorPath,

    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [int]$TimeoutMilliseconds,

    [Parameter(Mandatory = $false)]
    [ValidateSet(0, 1)]
    [int]$AllowPreSendAdjustment = 0,

    [Parameter(Mandatory = $true)]
    [string]$CancelPath
)

$ErrorActionPreference = "Stop"
$monitorScript = Join-Path $PSScriptRoot "set-vocaloid-save-filename.ps1"
$monitorStopPath = "$CancelPath.save-monitor-stop"
$monitorLogPath = "$CancelPath.save-monitor.log"
$monitorConfirmationPath = "$CancelPath.save-monitor-confirmed"
$monitorWindowPath = "$CancelPath.save-monitor-window"
$expectedFilename = [IO.Path]::GetFileName($OutputPath)
Remove-Item -LiteralPath $monitorStopPath, $monitorLogPath, $monitorConfirmationPath, $monitorWindowPath -Force -ErrorAction SilentlyContinue

$monitorArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$monitorScript`"",
    "-ExpectedFilename", "`"$expectedFilename`"",
    "-StopPath", "`"$monitorStopPath`"",
    "-LogPath", "`"$monitorLogPath`"",
    "-ConfirmationPath", "`"$monitorConfirmationPath`"",
    "-WindowPath", "`"$monitorWindowPath`"",
    "-TimeoutMilliseconds", ([string]$TimeoutMilliseconds)
)
$monitor = Start-Process -FilePath "powershell.exe" -ArgumentList $monitorArguments -WindowStyle Hidden -PassThru

try {
    & $HelperPath $EditorPath $ProjectPath $OutputPath ([string]$TimeoutMilliseconds) ([string]$AllowPreSendAdjustment) $CancelPath
    $helperExitCode = $LASTEXITCODE
} finally {
    [IO.File]::WriteAllText($monitorStopPath, "stop", [Text.Encoding]::ASCII)
    if ($null -ne $monitor -and -not $monitor.HasExited) {
        if (-not $monitor.WaitForExit(2000)) {
            Stop-Process -Id $monitor.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($helperExitCode -ne 0 -and (Test-Path -LiteralPath $monitorLogPath)) {
    [Console]::Error.WriteLine((Get-Content -LiteralPath $monitorLogPath -Raw))
}
Remove-Item -LiteralPath $monitorStopPath, $monitorLogPath, $monitorConfirmationPath, $monitorWindowPath -Force -ErrorAction SilentlyContinue
exit $helperExitCode
