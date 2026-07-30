$ErrorActionPreference = 'Stop'
$ControlledFailure = '{"ok":false,"error":{"code":"operation_failed"}}'
try {
  $PackageRoot = Split-Path -Parent $PSScriptRoot
  $env:OWNLOOP_PACKAGE_ROOT = $PackageRoot
  $RawOutput = @(& node (Join-Path $PackageRoot 'installer\dist\cli.js') @args 2>$null)
  $ExitCode = $LASTEXITCODE
  if ($RawOutput.Count -eq 1) {
    try {
      $Parsed = $RawOutput[0] | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $Parsed.ok) {
        Write-Output $RawOutput[0]
        exit $ExitCode
      }
    } catch {
      # Fall through to the controlled wrapper error.
    }
  }
  Write-Output $ControlledFailure
  exit 1
} catch {
  Write-Output $ControlledFailure
  exit 1
}
