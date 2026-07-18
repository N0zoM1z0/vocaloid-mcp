param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath,

    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class VocaloidOffscreenWindowApi {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(
        IntPtr window,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr window, int command);
}
"@

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    throw "VOCALOID executable does not exist: $ExecutablePath"
}
if (-not (Test-Path -LiteralPath $ProjectPath -PathType Leaf)) {
    throw "VSQX project does not exist: $ProjectPath"
}

$startArguments = @{
    FilePath = $ExecutablePath
    ArgumentList = @('"' + $ProjectPath + '"')
    WorkingDirectory = (Split-Path -Parent $ExecutablePath)
    WindowStyle = "Minimized"
    PassThru = $true
}
$process = Start-Process @startArguments

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
    if ($process.HasExited) {
        throw "VOCALOID exited before creating its main window (exit $($process.ExitCode))."
    }
} while ($process.MainWindowHandle -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline)

if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
    $process.Kill()
    throw "Timed out waiting for the VOCALOID main window."
}

# Restore only after moving the owner far outside the visible desktop. Modal
# children center on this owner and therefore stay offscreen too.
[VocaloidOffscreenWindowApi]::SetWindowPos(
    $process.MainWindowHandle,
    [IntPtr]::Zero,
    -32000,
    -32000,
    1280,
    900,
    0x0014
) | Out-Null
[VocaloidOffscreenWindowApi]::ShowWindowAsync($process.MainWindowHandle, 9) | Out-Null

[pscustomobject]@{
    ProcessId = $process.Id
    MainWindowHandle = $process.MainWindowHandle.ToInt64()
    MainWindowTitle = $process.MainWindowTitle
} | ConvertTo-Json -Compress
