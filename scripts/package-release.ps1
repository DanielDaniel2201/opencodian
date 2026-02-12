param(
  [string]$Version = "0.1.1",
  [string]$OpenCodeVersion = "1.1.56",
  [string]$BinaryPath = "D:\projects\oc-dev\opencodian\dist\bin\win\opencode.exe"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot\.."
$distRoot = Join-Path $repoRoot "release-temp"
$pluginRoot = Join-Path $distRoot "opencodian"
$zipName = "opencodian-windows-opencode-$OpenCodeVersion.zip"
$zipPath = Join-Path $distRoot $zipName

Write-Host "Building plugin..."
Push-Location $repoRoot
try {
  npm run build
}
finally {
  Pop-Location
}

if (Test-Path $distRoot) {
  Remove-Item -Recurse -Force $distRoot
}

New-Item -ItemType Directory -Path $pluginRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pluginRoot "bin\win") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $pluginRoot ".opencode") | Out-Null

Copy-Item -Path (Join-Path $repoRoot "main.js") -Destination $pluginRoot
Copy-Item -Path (Join-Path $repoRoot "manifest.json") -Destination $pluginRoot
Copy-Item -Path (Join-Path $repoRoot "styles.css") -Destination $pluginRoot
Copy-Item -Path (Join-Path $repoRoot ".opencode\start.md") -Destination (Join-Path $pluginRoot ".opencode")

if ([string]::IsNullOrWhiteSpace($BinaryPath)) {
  throw "BinaryPath is required. Provide the path to opencode.exe from OpenCode v$OpenCodeVersion."
}

if (-not (Test-Path $BinaryPath)) {
  throw "BinaryPath does not exist: $BinaryPath"
}

Copy-Item -Path $BinaryPath -Destination (Join-Path $pluginRoot "bin\win\opencode.exe")

if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}

Write-Host "Creating zip: $zipPath"
Compress-Archive -Path (Join-Path $distRoot "opencodian") -DestinationPath $zipPath

Write-Host "Done. Release zip at: $zipPath"
