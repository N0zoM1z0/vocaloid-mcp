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
    [int]$AllowPreSendAdjustment = 0
)

$ErrorActionPreference = "Stop"
& $HelperPath $EditorPath $ProjectPath $OutputPath ([string]$TimeoutMilliseconds) ([string]$AllowPreSendAdjustment)
exit $LASTEXITCODE
