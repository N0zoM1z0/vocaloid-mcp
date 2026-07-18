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
    [int]$TimeoutMilliseconds
)

$ErrorActionPreference = "Stop"
& $HelperPath $EditorPath $ProjectPath $OutputPath ([string]$TimeoutMilliseconds)
exit $LASTEXITCODE
