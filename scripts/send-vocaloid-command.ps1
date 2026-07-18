param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $true)]
    [uint32]$CommandId
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class VocaloidCommandApi {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(
        IntPtr window,
        uint message,
        UIntPtr wParam,
        IntPtr lParam,
        uint flags,
        uint timeoutMilliseconds,
        out UIntPtr result
    );
}
"@

$process = Get-Process -Id $ProcessId -ErrorAction Stop
if ($process.MainWindowHandle -eq [IntPtr]::Zero) {
    throw "Process $ProcessId has no main window."
}

$result = [UIntPtr]::Zero
[VocaloidCommandApi]::SendMessageTimeout(
    $process.MainWindowHandle,
    0x0111,
    [UIntPtr]$CommandId,
    [IntPtr]::Zero,
    0x0002,
    1000,
    [ref]$result
) | Out-Null
