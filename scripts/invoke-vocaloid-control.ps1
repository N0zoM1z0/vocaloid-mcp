param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [Parameter(Mandatory = $true)]
    [string]$AutomationId
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class VocaloidMouseInput {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(
        uint flags,
        uint dx,
        uint dy,
        uint data,
        UIntPtr extraInfo
    );
}
"@

$processCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $ProcessId
)
$idCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    $AutomationId
)
$condition = New-Object System.Windows.Automation.AndCondition(
    $processCondition,
    $idCondition
)
$element = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    $condition
)
if ($null -eq $element) {
    throw "No UI element with AutomationId '$AutomationId' in process $ProcessId."
}

$pattern = $null
if ($element.TryGetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern,
        [ref]$pattern
    )) {
    $pattern.Invoke()
    return
}

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$bounds = $element.Current.BoundingRectangle
if ($bounds.IsEmpty -or $element.Current.IsOffscreen) {
    throw "UI element '$AutomationId' is not clickable on screen."
}

$x = [int]($bounds.Left + ($bounds.Width / 2.0))
$y = [int]($bounds.Top + ($bounds.Height / 2.0))
[VocaloidMouseInput]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 100
[VocaloidMouseInput]::SetCursorPos($x, $y) | Out-Null
[VocaloidMouseInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[VocaloidMouseInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
