# Install Workshop on Windows, per user, no admin rights.
# It checks Node and creates %USERPROFILE%\.workshop. Start at login stays off unless you pass -Login.
# Run it from PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1   [-Login]
#Requires -Version 5
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Workshop needs Node 22 or later, and node is not on your PATH."
  Write-Host "Install Node 22 LTS from https://nodejs.org, then run this again."
  exit 1
}

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 22) {
  Write-Host "Workshop needs Node 22 or later. You have $(node -v)."
  Write-Host "Update Node from https://nodejs.org, then run this again."
  exit 1
}
Write-Host "Node $(node -v): ok."

# -Login on this script becomes --login for the workshop command.
$extra = @()
if ($args -contains '-Login' -or $args -contains '--login') { $extra += '--login' }

# Create the data folder (and turn on start at login with -Login).
node "$repo\workshop.mjs" install @extra

Write-Host ""
Write-Host "Start Workshop now with:  node `"$repo\workshop.mjs`" start"
Write-Host "Then open the address it prints in Chrome or Edge on this computer."
Write-Host "See docs/security.md for what Workshop stores and where."
