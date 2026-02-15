param(
  [ValidateSet("patch", "minor", "major")]
  [string]$ReleaseType = "patch",
  [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string[]]$Arguments = @()
  )

  Write-Host "> $Command $($Arguments -join ' ')"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

if ($PSBoundParameters.ContainsKey("ReleaseType") -and $PSBoundParameters.ContainsKey("Version")) {
  throw "Use either -ReleaseType or -Version, not both."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $repoRoot

try {
  if (-not (Test-Path "package.json")) {
    throw "package.json not found. Run this script inside the extension repository."
  }

  if ($PSBoundParameters.ContainsKey("Version")) {
    Invoke-Step -Command "npm" -Arguments @("version", $Version, "--no-git-tag-version")
  } else {
    Invoke-Step -Command "npm" -Arguments @("version", $ReleaseType, "--no-git-tag-version")
  }

  Invoke-Step -Command "npm" -Arguments @("run", "compile")
  Invoke-Step -Command "npx" -Arguments @("@vscode/vsce", "package")

  $packageName = (& node -p "require('./package.json').name").Trim()
  $packageVersion = (& node -p "require('./package.json').version").Trim()
  if (-not $packageName -or -not $packageVersion) {
    throw "Failed to read package name/version from package.json"
  }

  $vsixName = "$packageName-$packageVersion.vsix"
  $vsixPath = Join-Path $repoRoot $vsixName

  if (-not (Test-Path $vsixPath)) {
    throw "Expected VSIX not found: $vsixPath"
  }

  Write-Host "Package completed: version $packageVersion"
  Write-Host "VSIX: $vsixPath"
}
finally {
  Pop-Location
}
