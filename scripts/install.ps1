# Install Workshop on Windows, per user, no admin rights.
# It checks Node and creates %USERPROFILE%\.workshop. Start at login stays off unless you pass -Login.
# Run it from PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1   [-Login] [-WorkMode]
# -WorkMode turns on work mode and builds the pinned copy from the docket and runway folders next to Workshop (README.md, Work mode).
#Requires -Version 5
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Workshop needs Node 22 or later, and node is not on your PATH."
  Write-Host "Install Node 22 LTS from https://nodejs.org, then run this again."
  exit 1
}

# From "node -v" (v26.13.0), not node -p with a quoted script: Windows PowerShell 5.1 drops the inner
# double quotes on the way to node, so that check read every version as 0.
$ver = [version]((node -v).Trim().TrimStart('v'))
if ($ver.Major -lt 22) {
  Write-Host "Workshop needs Node 22 or later. You have $(node -v)."
  Write-Host "Update Node from https://nodejs.org, then run this again."
  exit 1
}
Write-Host "Node $(node -v): ok."

# -Login and -WorkMode on this script become --login and --work-mode for the workshop command.
$extra = @()
if ($args -contains '-Login' -or $args -contains '--login') { $extra += '--login' }
$work = $args -contains '-WorkMode' -or $args -contains '--work-mode'
if ($work) { $extra += '--work-mode' }
# A new install in work mode keeps its data in your company OneDrive when there is one (WORKSHOP_DATA_DIR overrides).
if ($env:WORKSHOP_DATA_DIR) { $extra += @('--data-dir', $env:WORKSHOP_DATA_DIR) } elseif ($work) { $extra += '--onedrive' }

# Create the data folder (and turn on start at login with -Login, work mode with -WorkMode).
node "$repo\workshop.mjs" install @extra
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($work) {
  node "$repo\workshop.mjs" pin
  if ($LASTEXITCODE -ne 0) { Write-Host "Building the pinned copy failed. See the messages above."; exit $LASTEXITCODE }
}

# A workshop command for new PowerShell windows (workshop start, workshop doctor, and so on), like the one-line installer.
$binDir = Join-Path $env:USERPROFILE '.workshop\bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$nodeExe = (Get-Command node).Source
Set-Content -Encoding ASCII -Path (Join-Path $binDir 'workshop.cmd') -Value "@`"$nodeExe`" `"$repo\workshop.mjs`" %*"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (@($userPath -split ';') -notcontains $binDir) { [Environment]::SetEnvironmentVariable('Path', (@($binDir) + @($userPath -split ';' | Where-Object { $_ })) -join ';', 'User') }

# Start menu shortcuts: Workshop (starts it if needed, then opens it), Restart Workshop, Stop Workshop.
try {
  $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Workshop'
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  foreach ($sc in @(@('Workshop', 'up'), @('Restart Workshop', 'restart'), @('Stop Workshop', 'stop'))) {
    $lnk = $shell.CreateShortcut((Join-Path $menu "$($sc[0]).lnk"))
    $lnk.TargetPath = $nodeExe
    $lnk.Arguments = "`"$repo\workshop.mjs`" $($sc[1])"
    $lnk.WorkingDirectory = $repo
    $lnk.WindowStyle = 7
    $lnk.Save()
  }
  Write-Host "Added Workshop, Restart Workshop and Stop Workshop to the Start menu."
} catch { Write-Host "Could not add Start menu shortcuts. Use: workshop up" }

Write-Host ""
Write-Host "Added the workshop command. Open a new PowerShell window to use it, or use node `"$repo\workshop.mjs`" until then."
Write-Host "Open Workshop from the Start menu (Workshop), or run:  workshop up   It starts Workshop if needed and opens it."
if ($work) {
  Write-Host "Workshop opens on this computer from the pinned copy. There is no Connect step in work mode; Home's Get started walks you through the rest."
  Write-Host "Check it with:  workshop doctor   and continue when it ends with: Result: all good."
} else {
  Write-Host "Then open the address it prints in Chrome or Edge on this computer, to sign in."
  Write-Host "After that, open https://workshop.alexisdavidson.org in the same browser and click Connect."
}
Write-Host "See docs/security.md for what Workshop stores and where."
