<#
.SYNOPSIS
    Builds a one-page HTML dashboard of every item in .work and the git state of the
    workspace repos, then opens it in your browser.

.DESCRIPTION
    Read-only. The only file it writes is the dashboard itself
    (<WorkRoot>\dashboard.html by default). It makes no network calls: links to ADO
    are built from workitem.md, config.json, and each repo's git remote.

    What it reads:
      .work\<id>-<name>\    workitem.md, repos.md, spec.md, plan.md, bug.md, tasks.md,
                            review.md, pr.md, paused.md, progress.md
      .work\spike-<name>\   findings.md
      .work\docs-<name>\    sources.md, check.md
      .work\tsd-<name>\     tsd.md, check.md
      .work\scope-<name>\   epics.md, stories.md, milestones.md, published.md
      .work\pr-<id>\        context.md, review.md (first-pass review of someone else's PR)
      Every git repo directly inside the workspace (the parent of .work):
                            branch, uncommitted files, unpushed commits, last commit
      config.json           ADO connections, only to build work item links

    The next-command logic matches /status. If you change the rules in
    commands\status.md, change Get-NextStep below to match.

    The LAST line of output is always the path of the dashboard file.

    With -AsJson it writes nothing: it prints the data as one line of JSON (ASCII only,
    other characters escaped) and exits. The live dashboard (live-server.mjs, server/model.mjs) uses
    this, so the static and live pages share one parser and one set of next-step rules.

.EXAMPLE
    .\New-Dashboard.ps1 -WorkRoot .work

.EXAMPLE
    .\New-Dashboard.ps1 -WorkRoot C:\src\work\.work -NoOpen

.EXAMPLE
    .\New-Dashboard.ps1 -WorkRoot .work -AsJson
#>
[CmdletBinding()]
param(
    [string]$WorkRoot = ".work",

    # Where to write the page. Default: <WorkRoot>\dashboard.html
    [string]$OutFile,

    [string]$ConfigPath = (Join-Path $(if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }) ".config/eng-agents/config.json"),

    # How many progress entries to send for Recent activity (the page groups them by day and item).
    [int]$Recent = 80,

    # Write the file but do not open a browser.
    [switch]$NoOpen,

    # Print the data as JSON instead of writing the page.
    [switch]$AsJson
)

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 wraps arrays as {"value":[...],"Count":n} in JSON without this.
if ($PSVersionTable.PSVersion.Major -lt 6) { Remove-TypeData System.Array -ErrorAction SilentlyContinue }

# ------------------------------------------------------------------- helpers

function Read-Text {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return [System.IO.File]::ReadAllText($Path)
}

function Write-Utf8 {
    param([string]$Path, [string]$Content)
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

# A template placeholder like "<state>" counts as empty.
function Get-CleanValue {
    param([string]$Value)
    if ($null -eq $Value) { return $null }
    $v = $Value.Trim()
    if ($v -match '^`([^`]*)`$') { $v = $Matches[1].Trim() }
    if (-not $v) { return $null }
    if ($v -match '^<.*>$') { return $null }
    return $v
}

# First "- Label: value" (or "Label: value") line in a markdown file.
function Get-Field {
    param([string]$Text, [string]$Label)
    if (-not $Text) { return $null }
    $m = [regex]::Match($Text, '(?mi)^\s*(?:-\s*)?' + [regex]::Escape($Label) + '\s*:[ \t]*(.*?)\s*$')
    if (-not $m.Success) { return $null }
    return Get-CleanValue $m.Groups[1].Value
}

# The body of "## Heading" up to the next "## ", without HTML comments.
function Get-Section {
    param([string]$Text, [string]$Heading)
    if (-not $Text) { return $null }
    $m = [regex]::Match($Text, '(?ms)^##\s+' + [regex]::Escape($Heading) + '[^\r\n]*\r?$(.*?)(?=^##\s|\z)')
    if (-not $m.Success) { return $null }
    $s = [regex]::Replace($m.Groups[1].Value, '(?s)<!--.*?-->', '').Trim()
    if (-not $s) { return $null }
    if ($s -match '^<[^>]*>$') { return $null }
    return $s
}

# The value of a "Status:" line, upper case, or $null if the file is missing.
function Get-GateStatus {
    param([string]$Path)
    $t = Read-Text $Path
    if ($null -eq $t) { return $null }
    $m = [regex]::Match($t, '(?mi)^\s*Status:\s*([A-Za-z ]+?)\s*$')
    if ($m.Success) { return $m.Groups[1].Value.ToUpperInvariant() }
    return "UNKNOWN"
}

function Get-EpochMs {
    param([datetime]$Date)
    return ([DateTimeOffset]$Date).ToUnixTimeMilliseconds()
}

# ---------------------------------------------------------------------- git

$script:GitOk = [bool](Get-Command git -ErrorAction SilentlyContinue)
$script:RepoCache = @{}

# Runs git in a repo. Returns stdout lines joined with LF, or $null on failure.
function Invoke-Git {
    param([string]$Repo, [string[]]$GitArgs)
    if (-not $script:GitOk) { return $null }
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = & git -C $Repo @GitArgs 2>$null
        $code = $LASTEXITCODE
    }
    catch { $out = $null; $code = 1 }
    finally { $ErrorActionPreference = $old }
    if ($code -ne 0) { return $null }
    if ($null -eq $out) { return "" }
    return (@($out) -join "`n")
}

# Turns a git remote into a browsable URL and the link builders for it.
function Get-RemoteWeb {
    param([string]$Remote)
    if (-not $Remote) { return $null }
    $u = $Remote.Trim()
    if ($u -match '^(?i)https?://') {
        $u = $u -replace '^(?i)(https?://)[^@/]+@', '$1'
    }
    elseif ($u -match '^(?i)(?:[^@/]+@)?ssh\.dev\.azure\.com:v3/([^/]+)/([^/]+)/(.+)$') {
        $u = "https://dev.azure.com/$($Matches[1])/$($Matches[2])/_git/$($Matches[3])"
    }
    elseif ($u -match '^(?i)ssh://(?:[^@/]+@)?([^/:]+)(?::\d+)?/(.+)$') {
        $u = "https://$($Matches[1])/$($Matches[2])"
    }
    elseif ($u -match '^(?:[^@/]+@)?([^:/]+):(.+)$') {
        $u = "https://$($Matches[1])/$($Matches[2])"
    }
    else { return $null }
    $u = $u.TrimEnd('/')
    $kind = "other"
    if ($u -match '/_git/') { $kind = "ado" }
    elseif ($u -match '(?i)//github\.com/') { $kind = "github"; $u = $u -replace '\.git$', '' }
    else { $u = $u -replace '\.git$', '' }
    return [pscustomobject]@{ Url = $u; Kind = $kind }
}

function Get-BranchLinks {
    param($Web, [string]$Branch, [string]$Base)
    if (-not $Web -or -not $Branch) { return $null }
    $e = [System.Uri]::EscapeDataString($Branch)
    $b = [System.Uri]::EscapeDataString($Base)
    if ($Web.Kind -eq "ado") {
        return [ordered]@{
            branch = "$($Web.Url)?version=GB$e"
            pr     = "$($Web.Url)/pullrequestcreate?sourceRef=$e&targetRef=$b"
        }
    }
    if ($Web.Kind -eq "github") {
        return [ordered]@{
            branch = "$($Web.Url)/tree/$Branch"
            pr     = "$($Web.Url)/compare/$Base...$($Branch)?expand=1"
        }
    }
    return $null
}

# Live git state of one repo folder. Cached by full path.
function Get-RepoState {
    param([string]$Path)
    $key = $Path.ToLowerInvariant()
    if ($script:RepoCache.ContainsKey($key)) { return $script:RepoCache[$key] }

    $s = [ordered]@{
        exists = (Test-Path -LiteralPath $Path -PathType Container)
        isGit = $false; branch = $null; detached = $false; upstream = $null
        ahead = 0; behind = 0; gone = $false; changed = 0; files = @()
        lastSha = $null; lastDate = $null; lastMsg = $null
        defaultBranch = "main"; unpushed = $null; web = $null; links = $null
    }
    if ($s.exists -and (Test-Path -LiteralPath (Join-Path $Path ".git"))) {
        $s.isGit = $true
        $st = Invoke-Git $Path @("status", "--porcelain=v1", "-b")
        if ($null -ne $st) {
            $lines = @($st -split "`n" | Where-Object { $_ -ne "" })
            if ($lines.Count -gt 0 -and $lines[0].StartsWith("## ")) {
                $h = $lines[0].Substring(3)
                if ($h -match '^No commits yet on (\S+)') { $s.branch = $Matches[1] }
                elseif ($h -match '^HEAD \(no branch\)') { $s.detached = $true }
                elseif ($h -match '^(.+?)\.\.\.(\S+)(?: \[(.+)\])?$') {
                    $s.branch = $Matches[1]; $s.upstream = $Matches[2]; $track = $Matches[3]
                    if ($track) {
                        if ($track -match 'ahead (\d+)') { $s.ahead = [int]$Matches[1] }
                        if ($track -match 'behind (\d+)') { $s.behind = [int]$Matches[1] }
                        if ($track -match 'gone') { $s.gone = $true }
                    }
                }
                else { $s.branch = ($h -replace ' \[.*\]$', '') }
                $changes = @($lines | Select-Object -Skip 1)
                $s.changed = $changes.Count
                $s.files = @($changes | Select-Object -First 8 | ForEach-Object { $_.Substring(3).Trim('"') })
            }
        }
        $log = Invoke-Git $Path @("log", "-1", "--format=%h%x1f%cI%x1f%s")
        if ($log) {
            $parts = $log.Split([char]0x1f)
            if ($parts.Count -ge 3) { $s.lastSha = $parts[0]; $s.lastDate = $parts[1]; $s.lastMsg = $parts[2] }
        }
        $def = Invoke-Git $Path @("symbolic-ref", "--short", "refs/remotes/origin/HEAD")
        if ($def) { $s.defaultBranch = ($def.Trim() -replace '^origin/', '') }
        if ($s.branch -and -not $s.upstream -and $s.branch -ne $s.defaultBranch) {
            $n = Invoke-Git $Path @("rev-list", "--count", "origin/$($s.defaultBranch)..HEAD")
            if ($n -match '^\d+$') { $s.unpushed = [int]$n }
        }
        $remote = Invoke-Git $Path @("remote", "get-url", "origin")
        $web = Get-RemoteWeb $remote
        if ($web) {
            $s.web = $web.Url
            $s.links = Get-BranchLinks $web $s.branch $s.defaultBranch
        }
        $s._webObj = $web
    }
    $script:RepoCache[$key] = $s
    return $s
}

# ------------------------------------------------------------------- config

$script:Connections = [ordered]@{}
$script:DefaultConnection = $null
if (Test-Path -LiteralPath $ConfigPath) {
    try {
        $cfg = (Read-Text $ConfigPath) | ConvertFrom-Json
        $cs = Get-Prop $cfg "connections"
        if ($cs) { foreach ($p in $cs.PSObject.Properties) { $script:Connections[$p.Name] = $p.Value } }
        elseif (Get-Prop $cfg "serverUrl") { $script:Connections["default"] = $cfg }
        $script:DefaultConnection = Get-Prop $cfg "default"
    }
    catch { Write-Warning "Could not read $ConfigPath. Work item links may be missing. $($_.Exception.Message)" }
}

function Get-WorkItemUrl {
    param([string]$Id, [string]$WorkItemText, $RepoStates)
    $link = Get-Field $WorkItemText "Link"
    if ($link -and $link -match '^(?i)https?://') { return $link }

    # From the "- ADO: <connection> (<collection>/<project>)" line written by Get-WorkItem.ps1.
    $ado = Get-Field $WorkItemText "ADO"
    if ($ado -and $ado -match '^(\S+)\s*\(([^/)]+)(?:/([^)]+))?\)') {
        $c = $script:Connections[$Matches[1]]
        $coll = $Matches[2]; $proj = $Matches[3]
        $server = Get-Prop $c "serverUrl"
        if ($server) {
            if (-not $proj) { $proj = Get-Prop $c "project" }
            $base = "$($server.TrimEnd('/'))/$coll"
            if ($proj) { return "$base/$([System.Uri]::EscapeDataString($proj))/_workitems/edit/$Id" }
            return "$base/_workitems/edit/$Id"
        }
    }

    # From an ADO repo remote: <server>/<collection>/<project>/_git/<repo>
    foreach ($r in $RepoStates) {
        if ($r.web -and $r.web -match '^(.+?)/_git/') { return "$($Matches[1])/_workitems/edit/$Id" }
    }

    # From the default (or only) connection.
    $name = $script:DefaultConnection
    if (-not $name -and $script:Connections.Count -eq 1) { $name = @($script:Connections.Keys)[0] }
    if ($name -and $script:Connections.Contains($name)) {
        $c = $script:Connections[$name]
        $server = Get-Prop $c "serverUrl"
        if ($server -and $server -notmatch 'example\.local') {
            $base = "$($server.TrimEnd('/'))/$(Get-Prop $c 'collection')"
            $proj = Get-Prop $c "project"
            if ($proj) { return "$base/$([System.Uri]::EscapeDataString($proj))/_workitems/edit/$Id" }
            return "$base/_workitems/edit/$Id"
        }
    }
    return $null
}

# ------------------------------------------------------------------ parsers

function Get-ProgressEntries {
    param([string]$Text)
    $entries = New-Object System.Collections.ArrayList
    if (-not $Text) { return , @() }
    $cur = $null
    foreach ($line in ($Text -split "\r?\n")) {
        $m = [regex]::Match($line, '^##\s+(\d{4}-\d{2}-\d{2}[^|]*?)\s*\|\s*(\S+)\s*(?:\|\s*(.*?))?\s*$')
        if ($m.Success) {
            $cur = [ordered]@{
                date = $m.Groups[1].Value.Trim(); command = $m.Groups[2].Value.Trim().Trim('`')
                agent = (Get-CleanValue $m.Groups[3].Value)
                did = $null; verify = $null; notes = $null; next = $null; first = $null
            }
            [void]$entries.Add($cur)
            continue
        }
        if ($line -match '^##\s') { $cur = $null; continue }
        if (-not $cur) { continue }
        $f = [regex]::Match($line, '^\s*-\s*(Did|Verify|Notes|Next)\s*:\s*(.*)$')
        if ($f.Success) {
            $cur[$f.Groups[1].Value.ToLowerInvariant()] = Get-CleanValue $f.Groups[2].Value
        }
        elseif (-not $cur.first -and $line -match '^\s*-\s+(.+)$') {
            $cur.first = Get-CleanValue $Matches[1]
        }
    }
    foreach ($e in $entries) {
        if (-not $e.did) { $e.did = $e.first }
        $e.Remove("first")
        if ($e.notes -and $e.notes -match '^(?i)none\.?$') { $e.notes = $null }
    }
    return , @($entries)
}

function Get-Tasks {
    param([string]$Text)
    $list = New-Object System.Collections.ArrayList
    if (-not $Text) { return , @() }
    $cur = $null
    foreach ($line in ($Text -split "\r?\n")) {
        $m = [regex]::Match($line, '^##\s*\[([ xX])\]\s*Task\s+(\d+)\s*:\s*(.+?)\s*$')
        if ($m.Success) {
            $title = $m.Groups[3].Value
            if ($title -match '^<.*>$') { $cur = $null; continue }
            $cur = [ordered]@{ n = [int]$m.Groups[2].Value; title = $title; done = ($m.Groups[1].Value -ne " "); repo = $null }
            [void]$list.Add($cur)
            continue
        }
        if ($cur -and -not $cur.repo -and $line -match '^\s*-\s*Repo:\s*(.+)$') { $cur.repo = Get-CleanValue $Matches[1] }
    }
    return , @($list)
}

function Get-RepoRows {
    param([string]$Text)
    $rows = New-Object System.Collections.ArrayList
    if (-not $Text) { return , @() }
    foreach ($line in ($Text -split "\r?\n")) {
        if ($line -notmatch '^\s*\|(.+)\|\s*$') { continue }
        $cells = @($Matches[1].Split("|") | ForEach-Object { $_.Trim().Trim('`').Trim() })
        if ($cells.Count -lt 3) { continue }
        if ($cells[0] -match '^(?i)order$' -or $cells[0] -match '^:?-+:?$') { continue }
        if (-not (Get-CleanValue $cells[1])) { continue }
        [void]$rows.Add([ordered]@{
                folder = $cells[1]
                branch = (Get-CleanValue $cells[2])
                shared = ($cells.Count -gt 3 -and $cells[3] -match '^(?i)y')
                why    = $(if ($cells.Count -gt 4) { Get-CleanValue $cells[4] } else { $null })
            })
    }
    return , @($rows)
}

# pr.md: one "## <repo>" section per repo with Branch, Title, and Description (templates\pr.md).
function Get-PrSections {
    param([string]$Text)
    $list = New-Object System.Collections.ArrayList
    if (-not $Text) { return , @() }
    $Text = [regex]::Replace(($Text -replace "\r\n", "`n"), '(?s)<!--.*?-->', '')
    foreach ($p in @([regex]::Split($Text, '(?m)^##[ \t]+') | Select-Object -Skip 1)) {
        $nl = $p.IndexOf("`n")
        $head = $(if ($nl -ge 0) { $p.Substring(0, $nl) } else { $p })
        $body = $(if ($nl -ge 0) { $p.Substring($nl + 1) } else { "" })
        $repo = Get-CleanValue $head
        if (-not $repo) { continue }
        $branch = $null; $target = $null
        $bm = [regex]::Match($body, '(?mi)^\s*(?:-\s*)?(?:\*\*)?Branch:(?:\*\*)?\s*`?([^`\s]+)`?\s*(?:->|=>|to|\u2192)\s*`?([^`\s]+)`?')
        if ($bm.Success) { $branch = Get-CleanValue $bm.Groups[1].Value; $target = Get-CleanValue $bm.Groups[2].Value }
        $title = $null
        $tm = [regex]::Match($body, '(?mi)^\s*(?:\*\*)?Title:(?:\*\*)?[ \t]*(.+?)\s*$')
        if ($tm.Success) { $title = Get-CleanValue ($tm.Groups[1].Value.Trim('*').Trim()) }
        $desc = $null
        $dm = [regex]::Match($body, '(?msi)^\s*(?:\*\*)?Description:(?:\*\*)?[ \t]*\n?(.*)\z')
        if ($dm.Success) {
            $d = [regex]::Replace($dm.Groups[1].Value, '(?m)^\s*-{3,}\s*$', '').Trim()
            if ($d -and $d -notmatch '^<[^>]*>$') { $desc = $d }
        }
        [void]$list.Add([ordered]@{ repo = $repo; branch = $branch; target = $target; title = $title; description = $desc })
    }
    return , @($list)
}

# Whether a branch is on origin, from what this clone last saw (no network).
function Get-PushState {
    param([string]$Repo, [string]$Branch)
    $s = [ordered]@{ local = $false; remote = $false; unpushed = $null }
    if (-not $Branch) { return $s }
    $s.local = $null -ne (Invoke-Git $Repo @("rev-parse", "--verify", "--quiet", "refs/heads/$Branch"))
    $s.remote = $null -ne (Invoke-Git $Repo @("rev-parse", "--verify", "--quiet", "refs/remotes/origin/$Branch"))
    if ($s.local -and $s.remote) {
        $n = Invoke-Git $Repo @("rev-list", "--count", "origin/$Branch..$Branch")
        if ($n -match '^\d+$') { $s.unpushed = [int]$n }
    }
    return $s
}

# A first-pass review of someone else's PR (.work/pr-<id>/, written by /pr-review). Same shape as
# templates/pr-review.md and the context.md that Get-PullRequest.ps1 writes.
function Get-PrReview {
    param([string]$Folder, [string]$PrId)
    $ctx = Read-Text (Join-Path $Folder "context.md")
    $rev = Read-Text (Join-Path $Folder "review.md")
    $out = [ordered]@{
        id = $PrId; title = $null; repo = $null; folder = $null; author = $null; branch = $null; url = $null
        commit = $null; size = $null; reviewed = $false; reviewedCommit = $null; reviewedOn = $null
        recommendation = $null; risk = $null; summary = $null
        counts = [ordered]@{ blocking = 0; "should-fix" = 0; optional = 0 }
        comments = @(); questions = @(); history = 0; state = "Fetching"; nextText = $null
    }
    $hist = Join-Path $Folder "history"
    if (Test-Path -LiteralPath $hist) { $out.history = @(Get-ChildItem -LiteralPath $hist -File -Filter "review-*.md" -ErrorAction SilentlyContinue).Count }
    if ($ctx) {
        if ($ctx -match '(?m)^#\s+Pull request\s+\d+:\s*(.+?)\s*$') { $out.title = $Matches[1] }
        if ($ctx -match '(?m)^-\s*Repo:\s*(.+?)\s*\(folder\s*`([^`]+)`\)') { $out.repo = $Matches[1]; $out.folder = $Matches[2] }
        $out.author = Get-Field $ctx "Author"
        $out.branch = Get-Field $ctx "Branch"
        $out.url = Get-Field $ctx "Link"
        $out.commit = Get-Field $ctx "Source commit"
        $out.size = Get-Field $ctx "Size"
        $out.state = "Reviewing"
        $out.nextText = "Finish the review with ``/pr-review $PrId``."
    }
    if ($rev) {
        $rc = Get-Field $rev "Reviewed commit"
        $out.reviewedCommit = $rc
        $out.reviewedOn = Get-Field $rev "Reviewed"
        $out.recommendation = Get-Field $rev "Recommendation"
        $out.risk = Get-Field $rev "Risk"
        $out.summary = Get-Section $rev "Summary"
        $out.reviewed = [bool]$out.recommendation
        $comments = Get-Section $rev "Comments"
        $list = New-Object System.Collections.ArrayList
        if ($comments) {
            foreach ($block in [regex]::Split($comments, '(?m)^###\s+')) {
                if ($block -notmatch '^(C\d+)\s*\r?\n') { continue }
                $c = [ordered]@{ id = $Matches[1]; file = $null; line = $null; severity = $null; why = $null; comment = $null }
                $c.file = Get-Field $block "File"
                $c.line = Get-Field $block "Line"
                $sev = Get-Field $block "Severity"
                if ($sev) { $sev = $sev.ToLowerInvariant() -replace '[^a-z-]', '' }
                if ($sev -eq "shouldfix") { $sev = "should-fix" }
                $c.severity = $(if ($sev -in @("blocking", "should-fix", "optional")) { $sev } else { "optional" })
                $c.why = Get-Field $block "Why"
                $quote = @(($block -split '\r?\n') | Where-Object { $_ -match '^\s*>' } | ForEach-Object { ($_ -replace '^\s*>\s?', '') })
                $c.comment = (($quote -join "`n").Trim())
                if (-not $c.comment) { $c.comment = $null }
                $out.counts[$c.severity]++
                [void]$list.Add($c)
            }
        }
        $out.comments = @($list)
        $qs = Get-Section $rev "Questions for the author"
        if ($qs) {
            $out.questions = @(($qs -split '\r?\n') | Where-Object { $_ -match '^\s*[-*]\s+' } | ForEach-Object { ($_ -replace '^\s*[-*]\s+', '').Trim() } | Where-Object { $_ -and $_ -notmatch '^(none\.?|<.*>)$' })
        }
        if ($out.reviewed) {
            $n = $out.comments.Count
            $out.state = "$($out.recommendation)$(if ($n) { ", $n comment$(if ($n -ne 1) { 's' })" } else { '' })"
            $out.nextText = $(if ($n) { "Read the drafts in review.md and post the ones you agree with on the PR." } else { "Nothing to raise. Approve it on the PR if you agree." })
            if ($out.commit -and $rc -and -not $out.commit.StartsWith($rc)) {
                $out.state = "Review is for an older commit"
                $out.nextText = "New commits since the review. Run ``/pr-review $PrId`` again."
            }
        }
    }
    return $out
}

function Get-LastModified {
    param([string]$Folder)
    $files = @(Get-ChildItem -LiteralPath $Folder -File -Recurse -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { return (Get-Item -LiteralPath $Folder).LastWriteTime }
    return ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
}

function Get-FileList {
    param([string]$Folder)
    $order = @("workitem.md", "brief.md", "repos.md", "spec.md", "bug.md", "plan.md", "tasks.md", "review.md", "pr.md", "paused.md", "progress.md", "findings.md", "tsd.md", "inventory.md", "sources.md", "check.md")
    $names = @(Get-ChildItem -LiteralPath $Folder -File -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
    $known = @($order | Where-Object { $names -contains $_ })
    $other = @($names | Where-Object { $order -notcontains $_ } | Sort-Object)
    return , @($known + $other)
}

# ------------------------------------------------------- next step (/status)

# Each pipeline command in plain words. The live dashboard and shells (such as Workshop) show
# these instead of the command, so this is the only place to change the wording. Sent to the page
# as stepWords; /do-task becomes "Task <n>: <title>".
$script:StepWords = [ordered]@{
    start = "Set up the repos and branches"; spec = "Write the spec"; plan = "Write the plan"; tasks = "Split the plan into tasks"
    bug = "Analyze the bug"; review = "Review the changes"; pr = "Write the PR text"; resume = "Resume this item"; approve = "Approve"
}
function Get-CommandText {
    param($I, [string]$Command)
    if (-not $Command) { return $null }
    $p = $Command -split '\s+'
    $name = $p[0].TrimStart('/')
    if ($name -eq "do-task" -and $p.Count -ge 3) {
        $n = [int]$p[2]
        $t = @($I.tasks.list | Where-Object { $_.n -eq $n }) | Select-Object -First 1
        return "Task $n$(if ($t) { ": $($t.title)" })"
    }
    if ($script:StepWords.Contains($name)) { return $script:StepWords[$name] }
    return $Command
}

# Mirrors the next-command rules in commands\status.md. First match wins.
# text: the step in plain words (the action when there is one, else the command's words).
function Get-NextStep {
    param($I, [string]$Folder)
    $id = $I.id; $lane = $I.lane; $g = $I.gates
    $tasksPath = Join-Path $Folder "tasks.md"
    $reviewPath = Join-Path $Folder "review.md"
    $step = { param($stage, $command, $action, $note, $needs)
        $text = $(if ($action) { $action } else { Get-CommandText $I $command })
        [ordered]@{ stage = $stage; command = $command; action = $action; text = $text; note = $note; needsYou = [bool]$needs } }

    if (-not $I.hasRepos) { return (& $step "start" "/start $id $lane" $null $null $false) }
    if ($lane -eq "feature" -and $null -eq $g.spec) { return (& $step "spec" "/spec $id" $null $null $false) }
    if ($g.spec -eq "DRAFT") { return (& $step "spec" "/approve $id" "Review spec.md" "Answer its open questions first. After approval: /plan $id" $true) }
    if ($lane -eq "feature" -and $null -eq $g.plan) { return (& $step "plan" "/plan $id" $null $null $false) }
    if ($g.plan -eq "DRAFT") { return (& $step "plan" "/approve $id" "Review plan.md" "After approval: /tasks $id" $true) }
    if ($lane -eq "bug" -and $null -eq $g.bug) { return (& $step "bug" "/bug $id" $null $null $false) }
    if ($g.bug -eq "DRAFT") { return (& $step "bug" "/approve $id" "Review bug.md and tasks.md" "After approval: start a new session (/new), then /do-task $id 1" $true) }
    if ($I.tasks.total -eq 0 -and -not (Test-Path -LiteralPath $tasksPath)) {
        $st = $(if ($lane -eq "bug") { "bug" } else { "tasks" })
        return (& $step $st "/tasks $id" $null $null $false)
    }
    $open = @($I.tasks.list | Where-Object { -not $_.done } | Sort-Object { $_.n })
    if ($open.Count -gt 0) {
        $n = $open[0].n
        if ($I.blocked) { return (& $step "build" "/do-task $id $n" "Task $n is blocked. Read the last progress.md entry, then split the task or fix the plan" "Start a new session (/new) before /do-task." $true) }
        return (& $step "build" "/do-task $id $n" $null "Start a new session (/new) first." $false)
    }
    $reviewStale = $false
    if ((Test-Path -LiteralPath $reviewPath) -and (Test-Path -LiteralPath $tasksPath)) {
        $reviewStale = (Get-Item -LiteralPath $tasksPath).LastWriteTime -gt (Get-Item -LiteralPath $reviewPath).LastWriteTime
    }
    if ($null -eq $g.review -or $reviewStale) { return (& $step "review" "/review $id" $null $null $false) }
    if ($g.review -match 'CHANGES') { return (& $step "review" $null "Pick which review.md findings become fix tasks, then /do-task them" "Re-run /review $id if you closed that session before answering." $true) }
    if (-not $I.hasPr) { return (& $step "pr" "/pr $id" $null $null $false) }
    return (& $step "ship" $null "Push the branches and open the PRs (text is in pr.md)" $null $false)
}

# ---------------------------------------------------------------- items

$workRootFull = (Resolve-Path -LiteralPath $WorkRoot -ErrorAction SilentlyContinue)
if (-not $workRootFull) { throw "No work folder at '$WorkRoot'. Run this from your workspace root, or pass -WorkRoot <path to .work>." }
$workRootFull = $workRootFull.Path
$workspace = Split-Path -Parent $workRootFull
if (-not $OutFile) { $OutFile = Join-Path $workRootFull "dashboard.html" }

$items = New-Object System.Collections.ArrayList
$activity = New-Object System.Collections.ArrayList

foreach ($dir in @(Get-ChildItem -LiteralPath $workRootFull -Directory | Where-Object { $_.Name -notlike "_*" -and $_.Name -notlike ".*" })) {
    $folder = $dir.FullName
    $modified = Get-LastModified $folder
    $base = [ordered]@{
        folder = $dir.Name
        modified = $modified.ToString("o")
        modifiedMs = (Get-EpochMs $modified)
        files = (Get-FileList $folder)
    }

    # Spikes, docs, TSDs, scopes, and PR reviews: light treatment.
    if ($dir.Name -match '^(spike|docs|tsd|scope|pr)-(.+)$') {
        $kind = $Matches[1]
        $base.kind = $kind
        $base.id = $null
        $base.title = ($Matches[2] -replace '-', ' ')
        $base.bucket = "notes"
        if ($kind -eq "spike") {
            $f = Read-Text (Join-Path $folder "findings.md")
            if ($f -match '(?m)^#\s+Spike findings:\s*(.+?)\s*$' -and (Get-CleanValue $Matches[1])) { $base.title = $Matches[1] }
            $base.summary = Get-Section $f "Short answer"
            $base.recommendation = Get-Section $f "Recommendation"
            $base.nextText = Get-Section $f "Next step"
            $base.state = $(if ($f) { "Findings written" } else { "In progress" })
        }
        elseif ($kind -eq "tsd") {
            $t = Read-Text (Join-Path $folder "tsd.md")
            if ($t -match '(?m)^#\s+Technical spec:\s*(.+?)\s*$' -and (Get-CleanValue $Matches[1])) { $base.title = $Matches[1] }
            $st = Get-GateStatus (Join-Path $folder "tsd.md")
            $check = Read-Text (Join-Path $folder "check.md")
            $wrong = 0
            if ($check) { $wrong = ([regex]::Matches($check, '(?mi)\|\s*(Wrong|Outdated)\s*\|')).Count }
            $rel = ".work/$($dir.Name)/tsd.md"
            if (-not $t) { $base.state = "In progress"; $base.nextText = "Finish the draft with ``/tsd``." }
            # /publish writes "Status: PUBLISHED to <path> on <date>", which the gate pattern (letters and spaces
            # only) reads as UNKNOWN, so look for the word itself too.
            elseif ($st -eq "PUBLISHED" -or $st -eq "APPROVED" -or $t -match '(?mi)^\s*Status:\s*PUBLISHED\b') { $base.state = "Published"; $base.nextText = "Commit the published copy in the product docs folder, if you have not." }
            elseif (-not $check) { $base.state = "Draft, not fact-checked"; $base.nextText = "Start a new session, then ``/check-docs $rel``." }
            elseif ($wrong -gt 0) { $base.state = "Draft, fact-check found $wrong wrong or outdated"; $base.nextText = "Fix what check.md flags (edit tsd.md or re-run ``/tsd``), then ``/publish $($dir.Name)``." }
            else { $base.state = "Draft, fact-checked"; $base.nextText = "Read it once more, then ``/publish $($dir.Name)``." }
        }
        elseif ($kind -eq "pr") {
            $base.title = "Pull request $($Matches[2])"
            $base.prReview = Get-PrReview $folder $Matches[2]
            if ($base.prReview.title) { $base.title = $base.prReview.title }
            $base.state = $base.prReview.state
            $base.summary = $base.prReview.summary
            $base.nextText = $base.prReview.nextText
        }
        elseif ($kind -eq "scope") {
            $e = Read-Text (Join-Path $folder "epics.md")
            if ($e -match '(?m)^Epic:\s*(.+?)\s*$' -and (Get-CleanValue $Matches[1])) { $base.title = $Matches[1] }
            $stories = Get-GateStatus (Join-Path $folder "stories.md")
            $miles = Get-GateStatus (Join-Path $folder "milestones.md")
            $hasCsv = Test-Path -LiteralPath (Join-Path $folder "backlog.csv")
            $hasPub = Test-Path -LiteralPath (Join-Path $folder "published.md")
            $n = $dir.Name
            if (-not $stories) { $base.state = "Scoping"; $base.nextText = "Finish scoping with ``/scope``." }
            elseif ($stories -ne "APPROVED") { $base.state = "Stories in review"; $base.nextText = "Review epics.md and stories.md, then ``/approve $n``." }
            elseif (-not $miles) { $base.state = "Stories approved"; $base.nextText = "``/slice $n``" }
            elseif ($miles -ne "APPROVED") { $base.state = "Milestones in review"; $base.nextText = "Review milestones.md, then ``/approve $n milestones``." }
            elseif ($hasPub) { $base.state = "Work items created"; $base.nextText = "See published.md, then ``/start <id> feature`` for the first story." }
            elseif ($hasCsv) { $base.state = "Import file ready"; $base.nextText = "Import backlog.csv in ADO, then ``/start <id> feature`` for the first story." }
            else { $base.state = "Milestones approved"; $base.nextText = "``/backlog $n``" }
        }
        else {
            $hasCheck = Test-Path -LiteralPath (Join-Path $folder "check.md")
            $base.state = $(if ($hasCheck) { "Fact-checked" } else { "Written, not checked yet" })
            $base.nextText = $(if ($hasCheck) { "Read check.md and fix anything it flags." } else { "Run /check-docs in a new session." })
        }
        [void]$items.Add($base)
        continue
    }

    # A work item folder is <id>-<short-name>. The id is a tracker number (ADO) or a local id, L<number>,
    # for work that has no tracker item (New-LocalWorkItem.ps1, or Dispatch's Start a work item).
    if ($dir.Name -notmatch '^(\d+|L\d+)-(.*)$') {
        $base.kind = "other"; $base.id = $null; $base.title = $dir.Name; $base.bucket = "notes"
        [void]$items.Add($base)
        continue
    }

    $id = $Matches[1]
    $slug = $Matches[2]
    $wi = Read-Text (Join-Path $folder "workitem.md")
    $reposText = Read-Text (Join-Path $folder "repos.md")
    $progressText = Read-Text (Join-Path $folder "progress.md")
    $pausedText = Read-Text (Join-Path $folder "paused.md")

    $title = $null
    if ($wi -and $wi -match '(?m)^#\s+Work item\s+L?\d+\s*:\s*(.+?)\s*$') { $title = Get-CleanValue $Matches[1] }
    if (-not $title -and $progressText -and $progressText -match '(?m)^#\s+Progress:\s*L?\d+\s+(.+?)\s*$') { $title = Get-CleanValue $Matches[1] }
    if (-not $title) { $title = ($slug -replace '-', ' ') }

    $type = Get-Field $wi "Type"
    $lane = Get-Field $reposText "Lane"
    $laneGuessed = $false
    if ($lane) { $lane = $lane.ToLowerInvariant() }
    else {
        $laneGuessed = $true
        $lane = $(if ($type -match '(?i)bug') { "bug" } else { "feature" })
    }

    $repoRows = Get-RepoRows $reposText
    $repoStates = New-Object System.Collections.ArrayList
    foreach ($r in $repoRows) {
        $path = Join-Path $workspace $r.folder
        $gs = Get-RepoState $path
        $links = $null
        if ($r.branch -and $gs._webObj) { $links = Get-BranchLinks $gs._webObj $r.branch $gs.defaultBranch }
        [void]$repoStates.Add([ordered]@{
                folder = $r.folder; branch = $r.branch; shared = $r.shared; why = $r.why
                git = $gs; links = $links
            })
    }

    $taskList = Get-Tasks (Read-Text (Join-Path $folder "tasks.md"))
    $tasks = [ordered]@{
        total = $taskList.Count
        done = @($taskList | Where-Object { $_.done }).Count
        list = $taskList
    }

    $reviewText = Read-Text (Join-Path $folder "review.md")
    $verdict = $null
    if ($reviewText) {
        $verdict = "UNKNOWN"
        if ($reviewText -match '(?mi)^\s*Verdict:\s*(.+?)\s*$') {
            $v = Get-CleanValue $Matches[1]
            if ($v) { $verdict = $v.ToUpperInvariant() }
        }
    }

    $entries = Get-ProgressEntries $progressText
    $i = 0
    foreach ($e in $entries) {
        [void]$activity.Add([ordered]@{
                date = $e.date; command = $e.command; agent = $e.agent; did = $e.did; verify = $e.verify
                id = $id; folder = $dir.Name; title = $title; order = $i; modifiedMs = $base.modifiedMs
            })
        $i++
    }
    $last = $null
    if ($entries.Count -gt 0) { $last = $entries[$entries.Count - 1] }

    # The last /do-task run failed or says it is blocked.
    $blocked = $null
    if ($last -and $last.command -match 'do-task') {
        $txt = "$($last.did) $($last.notes) $($last.verify)"
        if ($last.verify -match '(?i)\bFAIL' -or $txt -match '(?i)\bblocked\b') {
            $blocked = $(if ($last.notes) { $last.notes } elseif ($last.did) { $last.did } else { "Verify failed." })
        }
    }

    $paused = $null
    $pausedStatus = $null
    if ($pausedText -and $pausedText -match '(?mi)^\s*Status:\s*(\w+)') { $pausedStatus = $Matches[1].ToUpperInvariant() }
    if ($pausedStatus -eq "PAUSED") {
        $paused = [ordered]@{
            since = (Get-Field $pausedText "Paused")
            reason = (Get-Field $pausedText "Reason")
            inProgress = (Get-Field $pausedText "In progress")
            wip = (Get-Section $pausedText "Work in progress")
            waiting = (Get-Section $pausedText "Waiting on")
        }
        if ($paused.reason -match '^(?i)not given$') { $paused.reason = $null }
        if ($paused.wip -match '^(?i)none\.?$') { $paused.wip = $null }
        if ($paused.waiting -match '^(?i)-?\s*nothing\.?$') { $paused.waiting = $null }
    }

    $item = [ordered]@{
        kind = "item"; id = $id; folder = $base.folder; title = $title
        type = $type; adoState = (Get-Field $wi "State"); fetched = (Get-Field $wi "Fetched")
        lane = $lane; laneGuessed = $laneGuessed
        # A local item has no tracker, so only its own Link field (if the engineer added one) is a link.
        url = $(if ($id -like 'L*') { $l = Get-Field $wi "Link"; if ($l -match '^(?i)https?://') { $l } else { $null } } else { (Get-WorkItemUrl $id $wi $(@($repoStates | ForEach-Object { $_.git }))) })
        hasRepos = [bool]$reposText; hasPr = (Test-Path -LiteralPath (Join-Path $folder "pr.md"))
        gates = [ordered]@{
            spec = (Get-GateStatus (Join-Path $folder "spec.md"))
            plan = (Get-GateStatus (Join-Path $folder "plan.md"))
            bug = (Get-GateStatus (Join-Path $folder "bug.md"))
            review = $verdict
        }
        tasks = $tasks
        blocked = $blocked
        paused = $paused
        last = $last
        repos = @($repoStates)
        modified = $base.modified; modifiedMs = $base.modifiedMs
        files = $base.files
    }

    # PR text per repo, with the ADO "create PR" link and whether the branch is pushed.
    $prList = New-Object System.Collections.ArrayList
    if ($item.hasPr) {
        foreach ($sec in (Get-PrSections (Read-Text (Join-Path $folder "pr.md")))) {
            $row = @($repoStates | Where-Object { $_.folder -ieq $sec.repo -or (Split-Path -Leaf $_.folder) -ieq $sec.repo }) | Select-Object -First 1
            $folderName = $(if ($row) { $row.folder } else { $sec.repo })
            $branch = $(if ($sec.branch) { $sec.branch } elseif ($row) { $row.branch } else { $null })
            $repoPath = Join-Path $workspace $folderName
            $gs = Get-RepoState $repoPath
            $target = $(if ($sec.target) { $sec.target } else { $gs.defaultBranch })
            $links = $null
            if ($branch -and $gs._webObj) { $links = Get-BranchLinks $gs._webObj $branch $target }
            $push = $(if ($gs.isGit) { Get-PushState $repoPath $branch } else { $null })
            $q = $(if ($folderName -match '\s') { "`"$folderName`"" } else { $folderName })
            [void]$prList.Add([ordered]@{
                    repo = $folderName; branch = $branch; target = $target
                    title = $sec.title; description = $sec.description
                    links = $links; web = $gs.web; push = $push
                    pushCmd = $(if ($branch) { "git -C $q push -u origin $branch" } else { $null })
                })
        }
    }
    $item.pr = @($prList)

    $next = Get-NextStep $item $folder
    $item.next = $next
    $item.stage = $next.stage
    if ($paused) { $item.bucket = "paused" }
    elseif ($next.needsYou) { $item.bucket = "needs" }
    elseif ($next.stage -eq "ship") { $item.bucket = "ship" }
    else { $item.bucket = "active" }

    # What to type after a reboot.
    $resume = New-Object System.Collections.ArrayList
    [void]$resume.Add("cd `"$workspace`"")
    [void]$resume.Add("opencode")
    if ($paused) { [void]$resume.Add("/resume $id") }
    elseif ($next.command) { [void]$resume.Add($next.command) }
    $item.resume = @($resume)

    [void]$items.Add($item)
}

# ------------------------------------------------------- workspace repos

$itemIds = @($items | Where-Object { $_.kind -eq "item" } | ForEach-Object { $_.id })
$repos = New-Object System.Collections.ArrayList
# Repos at the top of the workspace, and one folder down (<workspace>/<Category>/<repo>). A repo's own
# folders are never searched. The folder is "repo" or "Category/repo", always with "/".
$repoDirs = New-Object System.Collections.ArrayList
foreach ($d in @(Get-ChildItem -LiteralPath $workspace -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike ".*" } | Sort-Object Name)) {
    if (Test-Path -LiteralPath (Join-Path $d.FullName ".git")) {
        [void]$repoDirs.Add([ordered]@{ folder = $d.Name; path = $d.FullName })
        continue
    }
    foreach ($c in @(Get-ChildItem -LiteralPath $d.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike ".*" } | Sort-Object Name)) {
        if (Test-Path -LiteralPath (Join-Path $c.FullName ".git")) {
            [void]$repoDirs.Add([ordered]@{ folder = "$($d.Name)/$($c.Name)"; path = $c.FullName })
        }
    }
}
foreach ($d in $repoDirs) {
    $gs = Get-RepoState $d.path
    $owner = $null
    if ($gs.branch -and $gs.branch -match '^dev/[^/]+/(\d+|L\d+)-') { $owner = $Matches[1] }
    [void]$repos.Add([ordered]@{
            folder = $d.folder
            git = $gs
            owner = $owner
            ownerKnown = [bool]($owner -and ($itemIds -contains $owner))
        })
}

# Drop the internal web object before serializing.
foreach ($s in $script:RepoCache.Values) { if ($s.Contains("_webObj")) { $s.Remove("_webObj") } }

$sortedActivity = @($activity | Sort-Object -Property @{ Expression = { $_.date }; Descending = $true }, @{ Expression = { $_.modifiedMs }; Descending = $true }, @{ Expression = { $_.order }; Descending = $true } | Select-Object -First $Recent)

$psExe = $(if ($PSVersionTable.PSVersion.Major -lt 6) { "powershell" } else { "pwsh" })
$versionFile = Join-Path $PSScriptRoot "VERSION"
$dashboardVersion = if (Test-Path -LiteralPath $versionFile) { (Read-Text $versionFile).Trim() } else { $null }
$now = Get-Date
$data = [ordered]@{
    generated = $now.ToString("o")
    generatedMs = (Get-EpochMs $now)
    workspace = $workspace
    workRoot = $workRootFull
    gitAvailable = $script:GitOk
    configFound = (Test-Path -LiteralPath $ConfigPath)
    dashboardVersion = $dashboardVersion
    stepWords = $script:StepWords
    refreshCommand = "/dashboard static"
    refreshShell = "$psExe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -WorkRoot `"$workRootFull`""
    liveShell = "$psExe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'Start-LiveDashboard.ps1')`""
    items = @($items | Sort-Object -Property @{ Expression = { $_.modifiedMs }; Descending = $true })
    repos = @($repos)
    activity = $sortedActivity
}

$json = ConvertTo-Json -InputObject $data -Depth 12 -Compress

if ($AsJson) {
    # ASCII only, so the console code page (Windows PowerShell 5.1) cannot garble it.
    $json = [regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    [Console]::Out.Write($json)
    [Console]::Out.Flush()
    return
}

# --------------------------------------------------------------- render

$templatePath = Join-Path $PSScriptRoot "dashboard.template.html"
$template = Read-Text $templatePath
if (-not $template) { throw "Template not found: $templatePath. Re-run install.ps1." }

# Keep "</script>" and similar out of the inline JSON block.
$json = $json.Replace("<", "\u003c").Replace(">", "\u003e").Replace("&", "\u0026")
$html = $template.Replace("__ENG_DATA__", $json)

Write-Utf8 $OutFile $html

$counts = @($items | Group-Object { $_.bucket } | ForEach-Object { "$($_.Name) $($_.Count)" }) -join ", "
Write-Output "Dashboard: $($items.Count) items ($counts), $($repos.Count) repos."

if (-not $NoOpen) {
    try {
        if ($PSVersionTable.PSVersion.Major -lt 6 -or $IsWindows) { Invoke-Item -LiteralPath $OutFile }
        elseif ($IsMacOS) { & open $OutFile }
        elseif (Get-Command xdg-open -ErrorAction SilentlyContinue) { & xdg-open $OutFile 2>$null | Out-Null }
    }
    catch { Write-Warning "Could not open a browser. Open the file yourself." }
}

Write-Output (Resolve-Path -LiteralPath $OutFile).Path
