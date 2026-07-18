param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,

    [int]$MaxElements = 300
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient

$process = Get-Process -Id $ProcessId -ErrorAction Stop
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $ProcessId
)
$elements = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    $condition
)

$limit = [Math]::Min($elements.Count, $MaxElements)
for ($index = 0; $index -lt $limit; $index++) {
    $element = $elements.Item($index)
    $current = $element.Current
    [pscustomobject]@{
        Index = $index
        Name = $current.Name
        Type = $current.ControlType.ProgrammaticName
        AutomationId = $current.AutomationId
        ClassName = $current.ClassName
        Handle = $current.NativeWindowHandle
        Enabled = $current.IsEnabled
        Offscreen = $current.IsOffscreen
        Bounds = [string]$current.BoundingRectangle
    }
}

if ($elements.Count -gt $limit) {
    Write-Warning "Truncated $($elements.Count) UI elements to $limit."
}

Write-Verbose "Inspected process $($process.Id): $($process.MainWindowTitle)"
