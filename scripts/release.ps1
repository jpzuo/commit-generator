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

  & git rev-parse --is-inside-work-tree | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Current directory is not a git repository."
  }

  & git diff --quiet
  if ($LASTEXITCODE -ne 0) {
    & git status --short
    throw "Git working tree has tracked changes. Commit or stash first."
  }

  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    & git status --short
    throw "Git index has staged changes. Commit or stash first."
  }

  $currentBranch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if ($currentBranch -eq "HEAD") {
    throw "Detached HEAD is not supported for release."
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

  $tagName = "v$packageVersion"
  & git rev-parse -q --verify "refs/tags/$tagName" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    throw "Tag already exists: $tagName"
  }

  $versionFiles = @("package.json")
  if (Test-Path "package-lock.json") {
    $versionFiles += "package-lock.json"
  }
  $addArgs = @("add") + $versionFiles
  Invoke-Step -Command "git" -Arguments $addArgs

  & git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    throw "No version file changes to commit."
  }

  Invoke-Step -Command "git" -Arguments @("commit", "-m", "chore(release): $tagName")
  Invoke-Step -Command "git" -Arguments @("tag", "-a", $tagName, "-m", "release $tagName")
  Invoke-Step -Command "git" -Arguments @("push", "origin", $currentBranch)
  Invoke-Step -Command "git" -Arguments @("push", "origin", $tagName)
  Write-Host "Tag created: $tagName"
  Write-Host "Version commit created: chore(release): $tagName"
  Write-Host "Branch pushed: $currentBranch (origin)"
  Write-Host "Tag pushed: $tagName (origin)"

  Write-Host "Package completed: version $packageVersion"
  Write-Host "VSIX: $vsixPath"
}
finally {
  Pop-Location
}
