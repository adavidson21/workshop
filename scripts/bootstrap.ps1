# Workshop and Tandem one-line installer for Windows. Per user, no admin rights.
#
#   irm https://dispatch.alexisdavidson.org/install.ps1 | iex
#
# The site serves this file with {{SITE}} filled in (worker/index.js), so Workshop allows the site it came from.
# What it does, all inside %LOCALAPPDATA%\Workshop unless something is already installed:
#   1. Node 22.15 or later: uses yours, or downloads a private copy.
#   2. Workshop and Tandem (eng-agents): downloads the latest from GitHub. No git needed for this.
#   3. opencode: uses yours, or installs it with npm into the Workshop folder. git: uses yours, or
#      downloads MinGit (Git for Windows' portable build) into the Workshop folder.
#   4. Installs Tandem into opencode (eng-agents install.ps1), then asks to connect an AI model
#      (opencode auth login) unless opencode already has one. WORKSHOP_SKIP_AI=1 skips the question.
#      opencode and Tandem are only for Dispatch: if either cannot be installed (for example a company network
#      blocks npm), the install carries on without them, and running this again later adds them.
#   5. Sets up Workshop: hosted mode for this site, and the opencode connector with workspace ~\work when opencode
#      is installed. Start at login stays as it is (off on a new install); WORKSHOP_LOGIN=1 turns it on.
#   6. Starts Workshop and opens it once in your browser, which signs this browser in.
# Running it again updates everything and keeps your settings.
# Environment overrides: WORKSHOP_INSTALL_DIR, WORKSHOP_WORKSPACE, WORKSHOP_SKIP_AI, WORKSHOP_LOGIN.
# Releases and work mode (docs/install.md, Work mode):
#   WORKSHOP_TAG=v1.2.0   install that Workshop release instead of the newest code (a git checkout moves to it)
#   TANDEM_TAG=v1.8.1     the same for Tandem (eng-agents)
#   WORKSHOP_WORK_MODE=1  work mode: Workshop runs from a pinned copy on this computer and no site can pair. Also
#                         downloads Docket, Runway, Rapport and Folio (DOCKET_TAG, RUNWAY_TAG, RECEIPTS_TAG and NOTES_TAG, else their newest code) and builds
#                         the copy (workshop pin).
#                         /install-work.ps1 is this installer with work mode on. On a new install, work mode keeps
#                         the data folder in your company OneDrive when there is one (WORKSHOP_DATA_DIR overrides).
# Dispatch (opencode, git, Tandem and an AI model) is only for coding agents:
#   WORKSHOP_DISPATCH=0   skip it: no opencode, no Tandem, no git download, no AI question
#   WORKSHOP_DISPATCH=1   install it. The default is 1, except in work mode, where it is 0 until you ask for it.
#   OPENCODE_VERSION=1.2.3  install that opencode version from npm instead of the newest one.

& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is many times slower with the progress bar on
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Site = '{{SITE}}'
if ($Site -notmatch '^https?://') { $Site = 'https://dispatch.alexisdavidson.org' }
$Root = if ($env:WORKSHOP_INSTALL_DIR) { $env:WORKSHOP_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Workshop' }
$Workspace = if ($env:WORKSHOP_WORKSPACE) { $env:WORKSHOP_WORKSPACE } else { '~/work' }
$Repos = @{ workshop = 'https://github.com/adavidson21/workshop'; 'eng-agents' = 'https://github.com/adavidson21/eng-agents'; docket = 'https://github.com/adavidson21/docket'; runway = 'https://github.com/adavidson21/runway'; receipts = 'https://github.com/adavidson21/receipts'; notes = 'https://github.com/adavidson21/notes' }
# /install-work.ps1 serves this file with {{WORK}} set to 1 (worker/index.js), so work mode needs no variable.
$Work = ($env:WORKSHOP_WORK_MODE -eq '1') -or ('{{WORK}}' -eq '1')
$Tags = @{ workshop = $env:WORKSHOP_TAG; 'eng-agents' = $env:TANDEM_TAG; docket = $env:DOCKET_TAG; runway = $env:RUNWAY_TAG; receipts = $env:RECEIPTS_TAG; notes = $env:NOTES_TAG }
$TagVars = @{ workshop = 'WORKSHOP_TAG'; 'eng-agents' = 'TANDEM_TAG'; docket = 'DOCKET_TAG'; runway = 'RUNWAY_TAG'; receipts = 'RECEIPTS_TAG'; notes = 'NOTES_TAG' }
# Dispatch installs a coding agent and talks to an AI provider, so in work mode it waits until you ask for it.
$Dispatch = if ($env:WORKSHOP_DISPATCH -eq '0') { $false } elseif ($env:WORKSHOP_DISPATCH -eq '1') { $true } else { -not $Work }
$OcVersion = if ($env:OPENCODE_VERSION) { $env:OPENCODE_VERSION } else { 'latest' }

function Say($text) { Write-Host "  $text" }
function Step($text) { Write-Host ""; Write-Host "> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "Install stopped: $text" -ForegroundColor Red; throw $text }

function Add-UserPath($dir) {
  $cur = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($cur -split ';' | Where-Object { $_ })
  if ($parts -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', (@($dir) + $parts) -join ';', 'User') }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$dir;$env:Path" }
}

# Download a zip and unpack it to $dest. With $sha256 (hex), the download must match it or nothing is unpacked.
function Get-Zip($url, $dest, $sha256 = $null) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'download.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    if ($sha256) {
      $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
      if ($got -ne $sha256.ToLowerInvariant()) { throw "The download from $url does not match its published SHA-256, so it was not used." }
      Say 'SHA-256 checked.'
    }
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
    $inner = @(Get-ChildItem (Join-Path $tmp 'x') -Directory)
    $src = if ($inner.Count -eq 1) { $inner[0].FullName } else { Join-Path $tmp 'x' }
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Move-Item $src $dest
  } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}

# A release tag: letters, digits, dots, dashes and underscores (v1.2.0).
foreach ($t in $Tags.Values) {
  if ($t -and ($t -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' -or $t.Contains('..'))) { Fail "`"$t`" is not a release tag like v1.2.0." }
}
if ($env:WORKSHOP_DISPATCH -and $env:WORKSHOP_DISPATCH -notmatch '^[01]$') { Fail "WORKSHOP_DISPATCH is 0 or 1, not `"$($env:WORKSHOP_DISPATCH)`"." }
if ($OcVersion -notmatch '^[0-9A-Za-z][0-9A-Za-z.+-]{0,49}$') { Fail "`"$OcVersion`" is not an opencode version like 1.2.3." }

Write-Host "Installing Workshop$(if ($Dispatch) { ' and Tandem' }) for $env:USERNAME (no admin rights needed)."
if (-not $Dispatch) { Write-Host 'Dispatch (opencode, Tandem, AI model) is not installed. Set WORKSHOP_DISPATCH=1 and run this again to add it.' }
New-Item -ItemType Directory -Force -Path $Root | Out-Null

# ---------------------------------------------------------------- 1. Node
Step 'Node'
$node = $null
$have = Get-Command node -ErrorAction SilentlyContinue
if ($have) {
  # 22.15 or later: from then on Node can trust the certificates Windows trusts (a company HTTPS proxy's own
  # certificate included), which the ADO connector and npm rely on.
  $haveVer = [version]((& $have.Source -v).TrimStart('v'))
  if ($haveVer -ge [version]'22.15.0') { $node = $have.Source; Say "Using your Node $(& $node -v)." }
  else { Say "Your Node is $(& $have.Source -v); Workshop needs 22.15 or later, so it gets its own copy." }
}
$nodeDir = Join-Path $Root 'node'
if (-not $node -and (Test-Path (Join-Path $nodeDir 'node.exe'))) { $node = Join-Path $nodeDir 'node.exe'; Say "Using Workshop's Node $(& $node -v)." }
if (-not $node) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $index = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
  $pick = $index | Where-Object { $_.lts -and ([int]($_.version.TrimStart('v').Split('.')[0]) -ge 22) -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
  if (-not $pick) { Fail 'Could not find a Node 22 or later download. Install Node LTS from https://nodejs.org and run this again.' }
  Say "Downloading Node $($pick.version)."
  $nodeZip = "node-$($pick.version)-win-$arch.zip"
  # nodejs.org publishes SHASUMS256.txt for every release. If it cannot be read, carry on and say so.
  $nodeSum = $null
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$($pick.version)/SHASUMS256.txt").Content
    $line = @($sums -split "`n" | Where-Object { $_ -match "^([0-9a-f]{64})\s+$([regex]::Escape($nodeZip))\s*$" }) | Select-Object -First 1
    if ($line -match '^([0-9a-f]{64})') { $nodeSum = $Matches[1] }
  } catch { }
  if (-not $nodeSum) { Say 'Could not read Node''s published SHA-256, so the download is not checked.' }
  try { Get-Zip "https://nodejs.org/dist/$($pick.version)/$nodeZip" $nodeDir $nodeSum } catch { Fail $_.Exception.Message }
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
$names = @('workshop')
if ($Dispatch) { $names += 'eng-agents' }
if ($Work) { $names += @('docket', 'runway', 'receipts', 'notes') }
foreach ($name in $names) {
  Step ($(if ($name -eq 'workshop') { 'Workshop' } elseif ($name -eq 'docket') { 'Docket (for the pinned copy)' } elseif ($name -eq 'runway') { 'Runway (for the pinned copy)' } elseif ($name -eq 'receipts') { 'Rapport (for the pinned copy)' } elseif ($name -eq 'notes') { 'Folio (for the pinned copy)' } else { 'Tandem (eng-agents)' }))
  $dir = Join-Path $Root $name
  $tag = $Tags[$name]
  if (Test-Path (Join-Path $dir '.git')) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Say 'This is a git checkout and git is not on PATH, so it is left as it is.' }
    elseif ($tag) {
      Say "Moving your git checkout to $tag."
      git -C $dir fetch --tags --quiet origin
      if ($LASTEXITCODE -ne 0) { Say 'Could not fetch tags; using the ones already here.' }
      git -C $dir checkout --quiet --detach "refs/tags/$tag"
      if ($LASTEXITCODE -ne 0) { Fail "There is no tag $tag in $dir, or it has local changes." }
    }
    else { Say 'Updating your git checkout.'; git -C $dir pull --ff-only }
    continue
  }
  $ref = if ($tag) { "refs/tags/$tag" } else { 'refs/heads/main' }
  # Runway, Rapport and Folio are optional: if a repo cannot be downloaded (no such tag, or GitHub could not be reached), skip it, and the
  # pinned copy is built without it until there is a clone of it here.
  if ($name -eq 'runway' -or $name -eq 'receipts' -or $name -eq 'notes') {
    $label = if ($name -eq 'runway') { 'Runway' } elseif ($name -eq 'notes') { 'Folio' } else { 'Rapport' }
    $reachable = $true
    try { Invoke-WebRequest -UseBasicParsing -Method Head -Uri "$($Repos[$name])/archive/$ref.zip" | Out-Null } catch { $reachable = $false }
    if (-not $reachable) {
      Say "$label could not be downloaded (no such tag, or GitHub could not be reached), so the pinned copy leaves it out."
      Say "To add it: git clone $($Repos[$name]) `"$dir`" (signed in to GitHub), then run: workshop pin"
      continue
    }
  }
  if (Test-Path $dir) {
    $prev = "$dir.previous"
    if (Test-Path $prev) { Remove-Item -Recurse -Force $prev }
    Move-Item $dir $prev
    Say "Kept the old copy at $prev."
  }
  if ($tag) {
    Say "Downloading release $tag from $($Repos[$name])."
    Get-Zip "$($Repos[$name])/archive/refs/tags/$tag.zip" $dir
  } else {
    Say "Downloading the latest from $($Repos[$name]) (not a release: set $($TagVars[$name]) to pin one)."
    Get-Zip "$($Repos[$name])/archive/refs/heads/main.zip" $dir
  }
}
$wsDir = Join-Path $Root 'workshop'
$engDir = Join-Path $Root 'eng-agents'

# ---------------------------------------------------------------- 3. opencode
Step 'opencode'
$opencode = $null
$oc = Get-Command opencode -ErrorAction SilentlyContinue
$ocDir = Join-Path $Root 'opencode'
$ocCmd = $null # the opencode command to use from here on, or $null when there is none
if (-not $Dispatch) { Say 'Skipped (WORKSHOP_DISPATCH=0, or work mode).' }
elseif ($oc -and ($oc.Source -notlike "$ocDir*")) { $ocCmd = $oc.Source; Say "Using your opencode at $ocCmd." }
else {
  Say $(if ($oc) { "Updating opencode ($OcVersion)." } else { "Installing opencode ($OcVersion)." })
  # A company network that inspects HTTPS uses its own certificate, which Windows trusts and npm does not.
  # Node 22.15 and later can use the Windows certificate store for this one npm run.
  $nodeVer = [version]((& $node -v).TrimStart('v'))
  $oldNodeOptions = $env:NODE_OPTIONS
  if ($nodeVer -ge [version]'22.15.0') { $env:NODE_OPTIONS = (@($oldNodeOptions, '--use-system-ca') | Where-Object { $_ }) -join ' ' }
  try { & $npm install --global --prefix $ocDir --no-fund --no-audit "opencode-ai@$OcVersion" } catch { $global:LASTEXITCODE = 1 }
  $env:NODE_OPTIONS = $oldNodeOptions
  $ocFile = Join-Path $ocDir 'opencode.cmd'
  if ($LASTEXITCODE -eq 0 -and (Test-Path $ocFile)) {
    Add-UserPath $ocDir
    $opencode = $ocFile
    $ocCmd = $ocFile
  } elseif (Test-Path $ocFile) {
    Add-UserPath $ocDir
    $opencode = $ocFile
    $ocCmd = $ocFile
    Say 'npm could not update opencode, so the copy you have stays.'
  } else {
    Write-Host '  npm could not install opencode. Workshop, Docket, Receipts and Home do not need it; Dispatch does.' -ForegroundColor Yellow
    Write-Host '  Carrying on without it. Install it from https://opencode.ai, or run this installer again later.' -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------- git
# Agents use git for branches, diffs and pushes. Use yours, or download MinGit (Git for Windows' portable
# build, no installer, no admin) into the Workshop folder and put it on your PATH.
Step 'git'
$gitDir = Join-Path $Root 'git'
$haveGit = Get-Command git -ErrorAction SilentlyContinue
if (-not $Dispatch) { Say 'Skipped: only Dispatch needs git.' }
elseif ($haveGit -and ($haveGit.Source -notlike "$gitDir*")) { Say "Using your $((git --version) -replace '^git version ', 'git ')." }
else {
  if (-not (Test-Path (Join-Path $gitDir 'cmd\git.exe'))) {
    try {
      $rel = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest'
      $want = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { '^MinGit-[0-9.]+(\.windows\.[0-9]+)?-arm64\.zip$' } else { '^MinGit-[0-9.]+(\.windows\.[0-9]+)?-64-bit\.zip$' }
      $asset = @($rel.assets | Where-Object { $_.name -match $want }) | Select-Object -First 1
      if ($asset) {
        Say "Downloading git ($($asset.name))."
        # GitHub lists each release file's SHA-256 as digest ("sha256:<hex>"). Older releases may not have it.
        $gitSum = if ("$($asset.digest)" -match '^sha256:([0-9a-fA-F]{64})$') { $Matches[1] } else { Say 'GitHub lists no SHA-256 for it, so the download is not checked.'; $null }
        Get-Zip $asset.browser_download_url $gitDir $gitSum
      }
      else { Say 'Could not find a git download. Install git from https://git-scm.com/downloads' }
    } catch { Say "Could not download git ($($_.Exception.Message)). Install it from https://git-scm.com/downloads" }
  }
  if (Test-Path (Join-Path $gitDir 'cmd\git.exe')) { Add-UserPath (Join-Path $gitDir 'cmd'); Say "Using Workshop's $((& (Join-Path $gitDir 'cmd\git.exe') --version) -replace '^git version ', 'git ')." }
}

# ---------------------------------------------------------------- 4. Tandem into opencode
Step 'Installing Tandem into opencode'
$tandemOk = $false
if (-not $Dispatch) { Say 'Skipped (WORKSHOP_DISPATCH=0, or work mode).' }
elseif (-not $ocCmd) { Say 'Skipped: Tandem runs in opencode, which is not installed.' }
else {
  $tandemArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $engDir 'install.ps1'))
  $personal = Join-Path $env:USERPROFILE '.config\eng-agents\personal'
  if (Test-Path $personal) { $tandemArgs += @('-Personal', $personal); Say "Using your personal layer at $personal." }
  & powershell.exe @tandemArgs
  if ($LASTEXITCODE -eq 0) {
    $tandemOk = $true
    # opencode reads agents when it starts, and 2.x's background service outlives this installer: restart it
    # so newly installed agents are found (otherwise Dispatch says "Agent not found").
    $ocv = (& $ocCmd --version 2>$null | Out-String)
    if ($ocv -match '(\d+)\.\d+\.\d+' -and [int]$Matches[1] -ge 2) {
      & $ocCmd service stop 2>$null | Out-Null
      & $ocCmd service start 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { Say 'Restarted opencode''s background service so it loads Tandem''s agents.' }
      else { Say 'Could not restart opencode''s background service. Run: opencode service stop, then opencode service start' }
    }
  }
  else { Write-Host '  Tandem did not install (see the messages above). Carrying on; Dispatch needs it, the other apps do not.' -ForegroundColor Yellow }
}

# ---------------------------------------------------------------- AI model
# Agents need an AI provider in opencode. Ask once, unless opencode already has one (saved credentials or a
# known API key variable). Skipped: Dispatch's Getting set up says how to connect one later.
Step 'AI model'
$hasAi = $false
foreach ($f in @((Join-Path $env:USERPROFILE '.local\share\opencode\auth.json'), (Join-Path $env:LOCALAPPDATA 'opencode\auth.json'))) {
  if (Test-Path $f) { try { if (@((Get-Content -Raw $f | ConvertFrom-Json).PSObject.Properties).Count -gt 0) { $hasAi = $true } } catch { } }
}
foreach ($v in @('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY')) {
  if ([Environment]::GetEnvironmentVariable($v)) { $hasAi = $true }
}
if (-not $Dispatch) { Say 'Skipped (WORKSHOP_DISPATCH=0, or work mode).' }
elseif (-not $ocCmd) { Say 'Skipped: opencode is not installed.' }
elseif ($hasAi) { Say 'opencode already has an AI provider.' }
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
$wsArgs = if ($Work) { @((Join-Path $wsDir 'workshop.mjs'), 'install', '--work-mode') } else { @((Join-Path $wsDir 'workshop.mjs'), 'install', '--allow', $Site) }
# Start at login is opt-in: run it by hand for a while first. A setting turned on earlier is kept either way.
if ($env:WORKSHOP_LOGIN -eq '1') { $wsArgs += '--login' }
# The data folder, for a new install only (an existing one is never moved): WORKSHOP_DATA_DIR, else in work mode
# the company OneDrive, which backs it up on storage the company manages.
if ($env:WORKSHOP_DATA_DIR) { $wsArgs += @('--data-dir', $env:WORKSHOP_DATA_DIR) } elseif ($Work) { $wsArgs += '--onedrive' }
if ($ocCmd) {
  New-Item -ItemType Directory -Force -Path $wsPath | Out-Null
  $wsArgs += @('--workspace', $Workspace)
  if ($opencode) { $wsArgs += @('--opencode', $opencode) }
}
& $node @wsArgs
if ($LASTEXITCODE -ne 0) { Fail 'Workshop setup failed. See the messages above.' }
if ($Work) {
  Step 'Building the pinned copy (work mode)'
  $runwayArgs = if (Test-Path (Join-Path $Root 'runway\app.json')) { @('--runway', (Join-Path $Root 'runway')) } else { @('--no-runway') }
  $receiptsArgs = if (Test-Path (Join-Path $Root 'receipts\app.json')) { @('--receipts', (Join-Path $Root 'receipts')) } else { @('--no-receipts') }
  $notesArgs = if (Test-Path (Join-Path $Root 'notes\app.json')) { @('--notes', (Join-Path $Root 'notes')) } else { @('--no-notes') }
  & $node (Join-Path $wsDir 'workshop.mjs') pin --docket (Join-Path $Root 'docket') @runwayArgs @receiptsArgs @notesArgs
  if ($LASTEXITCODE -ne 0) { Fail 'Building the pinned copy failed. See the messages above.' }
}

# A workshop command on PATH for new PowerShell windows: workshop open, workshop doctor, and so on.
$binDir = Join-Path $Root 'bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
Set-Content -Encoding ASCII -Path (Join-Path $binDir 'workshop.cmd') -Value "@`"$node`" `"$(Join-Path $wsDir 'workshop.mjs')`" %*"
Add-UserPath $binDir

# Start menu shortcuts, so Workshop opens like any other program: Workshop (starts it if needed, then opens it)
# and Restart Workshop. Per user, no admin rights. workshop uninstall removes them.
try {
  $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Workshop'
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  foreach ($sc in @(@('Workshop', 'up', 'Start Workshop if it is not running, then open it'), @('Restart Workshop', 'restart', 'Stop Workshop and start it again in the background'), @('Stop Workshop', 'stop', 'Stop Workshop'))) {
    $lnk = $shell.CreateShortcut((Join-Path $menu "$($sc[0]).lnk"))
    $lnk.TargetPath = $node
    $lnk.Arguments = "`"$(Join-Path $wsDir 'workshop.mjs')`" $($sc[1])"
    $lnk.WorkingDirectory = $wsDir
    $lnk.Description = $sc[2]
    $lnk.WindowStyle = 7
    if (Test-Path (Join-Path $wsDir 'icons\icon.ico')) { $lnk.IconLocation = Join-Path $wsDir 'icons\icon.ico' }
    $lnk.Save()
  }
  Say 'Added Workshop, Restart Workshop and Stop Workshop to the Start menu.'
} catch { Say 'Could not add Start menu shortcuts. Use  workshop up  instead.' }

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
$loginOn = $false
try { $cfgNow = Get-Content -Raw $cfgFile | ConvertFrom-Json; $loginOn = ($cfgNow.features.startAtLogin -eq $true) } catch { }
Write-Host ""
if ($loginOn) { Write-Host "Done. Workshop is running and starts when you log in." -ForegroundColor Green }
else {
  Write-Host "Done. Workshop is running." -ForegroundColor Green
  Write-Host "It does not start by itself when you log in. Each day, open Workshop from the Start menu (or run  workshop up ): it starts Workshop if needed and opens it."
  Write-Host "Something stuck? Start menu, Restart Workshop (or  workshop restart )."
}
if ($Work) {
  Write-Host "Workshop opened in your browser from the pinned copy on this computer (work mode). No site can pair with it."
  Write-Host "Using a different browser? Run  workshop open --print  in a new PowerShell window and open that address there."
} else {
  Write-Host "Workshop opened in your browser once to sign it in. Go back to $Site and click Connect."
  Write-Host "Using a different browser for Dispatch? Run  workshop open --print  in a new PowerShell window and open that address there."
}
if (-not $Dispatch) { Write-Host 'Dispatch is not installed. To add it later: set WORKSHOP_DISPATCH=1 and run this installer again.' }
elseif ($ocCmd -and $tandemOk) { Write-Host "Your work goes in $wsPath. Change it any time in Dispatch, under opencode settings." }
else { Write-Host "Dispatch is not set up yet (opencode or Tandem is missing). Run this installer again when you want it." -ForegroundColor Yellow }
}
