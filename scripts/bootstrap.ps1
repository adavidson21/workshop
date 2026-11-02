# Workshop and Tandem one-line installer for Windows. Per user, no admin rights.
#
#   irm https://dispatch.alexisdavidson.org/install.ps1 | iex
#
# The site serves this file with {{SITE}} filled in (worker/index.js), so Workshop allows the site it came from.
# What it does, all inside %LOCALAPPDATA%\Workshop unless something is already installed:
#   1. Node 22 or later: uses yours, or downloads a private copy.
#   2. Workshop and Tandem (eng-agents): downloads the latest from GitHub. No git needed for this.
#   3. opencode: uses yours, or installs it with npm into the Workshop folder. git: uses yours, or
#      downloads MinGit (Git for Windows' portable build) into the Workshop folder.
#   4. Installs Tandem into opencode (eng-agents install.ps1), then asks to connect an AI model
#      (opencode auth login) unless opencode already has one. WORKSHOP_SKIP_AI=1 skips the question.
#   5. Sets up Workshop: hosted mode for this site, the opencode connector with workspace ~\work, start at login.
#   6. Starts Workshop and opens it once in your browser, which signs this browser in.
# Running it again updates everything and keeps your settings.
# Environment overrides: WORKSHOP_INSTALL_DIR, WORKSHOP_WORKSPACE, WORKSHOP_SKIP_AI.

& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the progress bar on
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Site = '{{SITE}}'
if ($Site -notmatch '^https?://') { $Site = 'https://dispatch.alexisdavidson.org' }
$Root = if ($env:WORKSHOP_INSTALL_DIR) { $env:WORKSHOP_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Workshop' }
$Workspace = if ($env:WORKSHOP_WORKSPACE) { $env:WORKSHOP_WORKSPACE } else { '~/work' }
$Repos = @{ workshop = 'https://github.com/adavidson21/workshop'; 'eng-agents' = 'https://github.com/adavidson21/eng-agents' }

function Say($text) { Write-Host "  $text" }
function Step($text) { Write-Host ""; Write-Host "> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "Install stopped: $text" -ForegroundColor Red; throw $text }

function Add-UserPath($dir) {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($cur -split ';' | Where-Object { $_ })
  if ($parts -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', (@($dir) + $parts) -join ';', 'User') }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$dir;$env:Path" }
}

function Get-Zip($url, $dest) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'download.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
    $inner = @(Get-ChildItem (Join-Path $tmp 'x') -Directory)
    $src = if ($inner.Count -eq 1) { $inner[0].FullName } else { Join-Path $tmp 'x' }
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item $src $dest
  } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}

Write-Host "Installing Workshop and Tandem for $env:USERNAME (no admin rights needed)."
New-Item -ItemType Directory -Force -Path $Root | Out-Null

# ---------------------------------------------------------------- 1. Node
Step 'Node'
$node = $null
$have = Get-Command node -ErrorAction SilentlyContinue
if ($have) {
  $major = [int](& $have.Source -p 'process.versions.node.split(".")[0]')
  if ($major -ge 22) { $node = $have.Source; Say "Using your Node $(& $node -v)." }
  else { Say "Your Node is $(& $have.Source -v); Workshop needs 22 or later, so it gets its own copy." }
}
$nodeDir = Join-Path $Root 'node'
if (-not $node -and (Test-Path (Join-Path $nodeDir 'node.exe'))) { $node = Join-Path $nodeDir 'node.exe'; Say "Using Workshop's Node $(& $node -v)." }
if (-not $node) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $index = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
  $pick = $index | Where-Object { $_.lts -and ([int]($_.version.TrimStart('v').Split('.')[0]) -ge 22) -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
  if (-not $pick) { Fail 'Could not find a Node 22 or later download. Install Node LTS from https://nodejs.org and run this again.' }
  Say "Downloading Node $($pick.version)."
  Get-Zip "https://nodejs.org/dist/$($pick.version)/node-$($pick.version)-win-$arch.zip" $nodeDir
  $node = Join-Path $nodeDir 'node.exe'
  Add-UserPath $nodeDir
}
$nodeHome = Split-Path -Parent $node
$npm = Join-Path $nodeHome 'npm.cmd'

# ---------------------------------------------------------------- stop a running Workshop before updating it
$port = 4380
$cfgFile = Join-Path $env:USERPROFILE '.workshop\config.json'
if (Test-Path $cfgFile) { try { $p = (Get-Content -Raw $cfgFile | ConvertFrom-Json).port; if ($p) { $port = [int]$p } } catch { } }
function Test-Workshop { try { $r = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/api/health"; return $r.app -eq 'workshop-agent' } catch { return $false } }
if (Test-Workshop) {
  Step 'Stopping Workshop so it can be updated'
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }
  if (Test-Workshop) { Fail "Workshop is running on port $port and could not be stopped. Close it, then run this again." }
}

# ---------------------------------------------------------------- 2. Workshop and Tandem
foreach ($name in @('workshop', 'eng-agents')) {
  Step ($(if ($name -eq 'workshop') { 'Workshop' } else { 'Tandem (eng-agents)' }))
  $dir = Join-Path $Root $name
  if (Test-Path (Join-Path $dir '.git')) {
    if (Get-Command git -ErrorAction SilentlyContinue) { Say 'Updating your git checkout.'; git -C $dir pull --ff-only }
    else { Say 'This is a git checkout and git is not on PATH, so it is left as it is.' }
    continue
  }
  if (Test-Path $dir) {
    $prev = "$dir.previous"
    if (Test-Path $prev) { Remove-Item -Recurse -Force $prev }
    Move-Item $dir $prev
    Say "Kept the old copy at $prev."
  }
  Say "Downloading the latest from $($Repos[$name])."
  Get-Zip "$($Repos[$name])/archive/refs/heads/main.zip" $dir
}
$wsDir = Join-Path $Root 'workshop'
$engDir = Join-Path $Root 'eng-agents'

# ---------------------------------------------------------------- 3. opencode
Step 'opencode'
$opencode = $null
$oc = Get-Command opencode -ErrorAction SilentlyContinue
$ocDir = Join-Path $Root 'opencode'
if ($oc -and ($oc.Source -notlike "$ocDir*")) { Say "Using your opencode at $($oc.Source)." }
else {
  Say $(if ($oc) { 'Updating opencode.' } else { 'Installing opencode.' })
  & $npm install --global --prefix $ocDir --no-fund --no-audit opencode-ai@latest
  if ($LASTEXITCODE -ne 0) { Fail 'npm could not install opencode. Install it from https://opencode.ai, then run this again.' }
  Add-UserPath $ocDir
  $opencode = Join-Path $ocDir 'opencode.cmd'
}

# ---------------------------------------------------------------- git
# Agents use git for branches, diffs and pushes. Use yours, or download MinGit (Git for Windows' portable
# build, no installer, no admin) into the Workshop folder and put it on your PATH.
Step 'git'
$gitDir = Join-Path $Root 'git'
$haveGit = Get-Command git -ErrorAction SilentlyContinue
if ($haveGit -and ($haveGit.Source -notlike "$gitDir*")) { Say "Using your $((git --version) -replace '^git version ', 'git ')." }
else {
  if (-not (Test-Path (Join-Path $gitDir 'cmd\git.exe'))) {
    try {
      $rel = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest'
      $want = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { '^MinGit-[0-9.]+(\.windows\.[0-9]+)?-arm64\.zip$' } else { '^MinGit-[0-9.]+(\.windows\.[0-9]+)?-64-bit\.zip$' }
      $asset = @($rel.assets | Where-Object { $_.name -match $want }) | Select-Object -First 1
      if ($asset) { Say "Downloading git ($($asset.name))."; Get-Zip $asset.browser_download_url $gitDir }
      else { Say 'Could not find a git download. Install git from https://git-scm.com/downloads' }
    } catch { Say "Could not download git ($($_.Exception.Message)). Install it from https://git-scm.com/downloads" }
  }
  if (Test-Path (Join-Path $gitDir 'cmd\git.exe')) { Add-UserPath (Join-Path $gitDir 'cmd'); Say "Using Workshop's $((& (Join-Path $gitDir 'cmd\git.exe') --version) -replace '^git version ', 'git ')." }
}

# ---------------------------------------------------------------- 4. Tandem into opencode
Step 'Installing Tandem into opencode'
$tandemArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $engDir 'install.ps1'))
$personal = Join-Path $env:USERPROFILE '.config\eng-agents\personal'
if (Test-Path $personal) { $tandemArgs += @('-Personal', $personal); Say "Using your personal layer at $personal." }
& powershell.exe @tandemArgs
if ($LASTEXITCODE -ne 0) { Fail 'Tandem install failed. See the messages above.' }

# ---------------------------------------------------------------- AI model
# Agents need an AI provider in opencode. Ask once, unless opencode already has one (saved credentials or a
# known API key variable). Skipped: Dispatch's Getting set up says how to connect one later.
Step 'AI model'
$ocCmd = if ($opencode) { $opencode } else { $oc.Source }
$hasAi = $false
foreach ($f in @((Join-Path $env:USERPROFILE '.local\share\opencode\auth.json'), (Join-Path $env:LOCALAPPDATA 'opencode\auth.json'))) {
  if (Test-Path $f) { try { if (@((Get-Content -Raw $f | ConvertFrom-Json).PSObject.Properties).Count -gt 0) { $hasAi = $true } } catch { } }
}
foreach ($v in @('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY')) {
  if ([Environment]::GetEnvironmentVariable($v)) { $hasAi = $true }
}
if ($hasAi) { Say 'opencode already has an AI provider.' }
elseif ($env:WORKSHOP_SKIP_AI -or -not [Environment]::UserInteractive) { Say 'Later: run  opencode auth login  to connect an AI model. Dispatch shows how.' }
else {
  Say 'Agents need an AI model. You pick a provider and paste its API key; it stays in opencode on this computer.'
  Say 'For Claude, pick Anthropic and use a key from https://console.anthropic.com'
  $ans = Read-Host '  Connect one now? [Y/n]'
  if ($ans -match '^(n|no)$') { Say 'Skipped. Dispatch shows how to connect one later.' }
  else {
    & $ocCmd auth login
    if ($LASTEXITCODE -ne 0) { Say 'Not connected. Run  opencode auth login  later; Dispatch shows how.' }
  }
}

# ---------------------------------------------------------------- 5. Workshop setup
Step 'Setting up Workshop'
$wsPath = $Workspace -replace '^~', $env:USERPROFILE
New-Item -ItemType Directory -Force -Path $wsPath | Out-Null
$wsArgs = @((Join-Path $wsDir 'workshop.mjs'), 'install', '--login', '--allow', $Site, '--workspace', $Workspace)
if ($opencode) { $wsArgs += @('--opencode', $opencode) }
& $node @wsArgs
if ($LASTEXITCODE -ne 0) { Fail 'Workshop setup failed. See the messages above.' }

# A workshop command on PATH for new PowerShell windows: workshop open, workshop doctor, and so on.
$binDir = Join-Path $Root 'bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Set-Content -Encoding ASCII -Path (Join-Path $binDir 'workshop.cmd') -Value "@`"$node`" `"$(Join-Path $wsDir 'workshop.mjs')`" %*"
Add-UserPath $binDir

# ---------------------------------------------------------------- 6. start and sign in
Step 'Starting Workshop'
Start-Process -FilePath $node -ArgumentList @("`"$(Join-Path $wsDir 'agent\start.mjs')`"", '--quiet') -WindowStyle Hidden
$up = $false
for ($i = 0; $i -lt 40 -and -not $up; $i++) { Start-Sleep -Milliseconds 500; $up = Test-Workshop }
if (-not $up) { Fail "Workshop did not start. Run: `"$node`" `"$(Join-Path $wsDir 'workshop.mjs')`" start  to see why." }
& $node (Join-Path $wsDir 'workshop.mjs') open | Out-Null

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Note: git is not installed. Tandem needs it to make branches and pull requests: https://git-scm.com/downloads" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Done. Workshop is running and starts when you log in." -ForegroundColor Green
Write-Host "Workshop opened in your browser once to sign it in. Go back to $Site and click Connect."
Write-Host "Using a different browser for Dispatch? Run  workshop open --print  in a new PowerShell window and open that address there."
Write-Host "Your work goes in $wsPath. Change it any time in Dispatch, under opencode settings."
}
