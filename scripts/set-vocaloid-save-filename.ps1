param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedFilename,

    [Parameter(Mandatory = $true)]
    [string]$StopPath,

    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [Parameter(Mandatory = $true)]
    [string]$ConfirmationPath,

    [Parameter(Mandatory = $true)]
    [string]$WindowPath,

    [Parameter(Mandatory = $true)]
    [int]$TimeoutMilliseconds
)

$ErrorActionPreference = "Stop"

function Write-MonitorLog {
    param([string]$Message)
    $timestamp = [DateTime]::UtcNow.ToString("o")
    [IO.File]::AppendAllText($LogPath, "$timestamp $Message`r`n", [Text.Encoding]::UTF8)
}

try {
    Add-Type -AssemblyName UIAutomationClient
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    $loggedWindow = $false
    $consecutiveExactReads = 0

    while ([DateTime]::UtcNow -lt $deadline -and -not [IO.File]::Exists($StopPath)) {
        if ([IO.File]::Exists($WindowPath)) {
            try {
                $rawHandle = [IO.File]::ReadAllText($WindowPath).Trim()
                if ($rawHandle.Length -eq 0) {
                    Start-Sleep -Milliseconds 25
                    continue
                }
                $numericHandle = [Int64]::Parse(
                    $rawHandle,
                    [Globalization.NumberStyles]::Integer,
                    [Globalization.CultureInfo]::InvariantCulture
                )
                $filenameEdit = [System.Windows.Automation.AutomationElement]::FromHandle(
                    [IntPtr]$numericHandle
                )
                if ($null -eq $filenameEdit) {
                    throw "UI Automation could not resolve published filename HWND $rawHandle"
                }
                if (-not $loggedWindow) {
                    Write-MonitorLog (
                        "published candidate automation_id=$($filenameEdit.Current.AutomationId) " +
                        "name=$($filenameEdit.Current.Name) class=$($filenameEdit.Current.ClassName) " +
                        "handle=$($filenameEdit.Current.NativeWindowHandle) expected=$ExpectedFilename"
                    )
                    $loggedWindow = $true
                }
                if ($filenameEdit.Current.ClassName -ne "Edit") {
                    throw "Published filename HWND has unexpected class $($filenameEdit.Current.ClassName)"
                }

                $observedValues = @($filenameEdit.Current.Name)
                if ($observedValues -contains $ExpectedFilename) {
                    $consecutiveExactReads += 1
                    if ($consecutiveExactReads -ge 2) {
                        [IO.File]::WriteAllText(
                            $ConfirmationPath,
                            "confirmed",
                            [Text.Encoding]::ASCII
                        )
                        Write-MonitorLog "confirmed stable exact VOCALOID filename through published HWND accessibility"
                        exit 0
                    }
                } else {
                    $consecutiveExactReads = 0
                }
            } catch {
                Write-MonitorLog "candidate failed: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Milliseconds 50
    }

    if ([IO.File]::Exists($StopPath)) {
        Write-MonitorLog "stopped by wrapper"
        exit 0
    }
    Write-MonitorLog "timed out without confirming a VOCALOID filename"
    exit 1
} catch {
    Write-MonitorLog "fatal: $($_.Exception.Message)"
    exit 2
}
