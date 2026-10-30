#!/usr/bin/env bash
# Workshop and Tandem one-line installer for macOS and Linux. Per user, no admin rights, no sudo.
#
#   curl -fsSL https://dispatch.alexisdavidson.org/install.sh | bash
#
# The site serves this file with {{SITE}} filled in (worker/index.js), so Workshop allows the site it came from.
# What it does, all inside ~/.local/share/workshop unless something is already installed:
#   1. Node 22 or later: uses yours, or downloads a private copy.
#   2. Workshop and Tandem (eng-agents): downloads the latest from GitHub. No git needed for this.
#   3. opencode: uses yours, or installs it with npm into the Workshop folder.
#   4. PowerShell 7 (pwsh), which Tandem runs on: uses yours, or downloads a private copy.
#   5. Installs Tandem into opencode (eng-agents install.ps1).
#   6. Sets up Workshop: hosted mode for this site, the opencode connector with workspace ~/work, start at login.
#   7. Starts Workshop and opens it once in your browser, which signs this browser in.
# Running it again updates everything and keeps your settings.
# Environment overrides: WORKSHOP_INSTALL_DIR, WORKSHOP_WORKSPACE.
set -euo pipefail

main() {
  SITE='{{SITE}}'
  case "$SITE" in http://*|https://*) ;; *) SITE='https://dispatch.alexisdavidson.org' ;; esac
  ROOT="${WORKSHOP_INSTALL_DIR:-$HOME/.local/share/workshop}"
  WORKSPACE="${WORKSHOP_WORKSPACE:-~/work}"
  OS="$(uname -s)"; ARCH="$(uname -m)"

  say()  { printf '  %s\n' "$*"; }
  step() { printf '\n\033[36m> %s\033[0m\n' "$*"; }
  fail() { printf '\n\033[31mInstall stopped: %s\033[0m\n' "$*" >&2; exit 1; }
  need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is needed and was not found."; }
  need curl; need tar; need uname

  if [ "$(id -u)" = "0" ]; then fail "Do not run this with sudo. It installs for your user only."; fi
  case "$OS" in Darwin) os=darwin; psos=osx ;; Linux) os=linux; psos=linux ;; *) fail "This installer is for macOS and Linux. On Windows use install.ps1." ;; esac
  case "$ARCH" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) fail "Unsupported processor: $ARCH." ;; esac

  echo "Installing Workshop and Tandem for $(id -un) (no admin rights needed)."
  mkdir -p "$ROOT"

  # Download a .tar.gz and unpack its single top folder as $2.
  get_tar() {
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL "$1" -o "$tmp/download.tar.gz"
    mkdir "$tmp/x"; tar -xzf "$tmp/download.tar.gz" -C "$tmp/x"
    local inner; inner="$(find "$tmp/x" -mindepth 1 -maxdepth 1)"
    if [ "$(printf '%s\n' "$inner" | wc -l | tr -d ' ')" = "1" ] && [ -d "$inner" ]; then :; else inner="$tmp/x"; fi
    rm -rf "$2"; mv "$inner" "$2"; rm -rf "$tmp"
  }

  # ------------------------------------------------------------ 1. Node
  step "Node"
  NODE=""
  if command -v node >/dev/null 2>&1; then
    if [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then NODE="$(command -v node)"; say "Using your Node $(node -v)."
    else say "Your Node is $(node -v); Workshop needs 22 or later, so it gets its own copy."; fi
  fi
  if [ -z "$NODE" ] && [ -x "$ROOT/node/bin/node" ]; then NODE="$ROOT/node/bin/node"; say "Using Workshop's Node $("$NODE" -v)."; fi
  if [ -z "$NODE" ]; then
    local key; [ "$os" = darwin ] && key="osx-$arch-tar" || key="linux-$arch"
    # index.tab columns: version date files npm v8 uv zlib openssl modules lts security. Newest LTS first.
    local ver; ver="$(curl -fsSL https://nodejs.org/dist/index.tab | awk -F'\t' -v k="$key" 'NR>1 && $10!="-" { split(substr($1,2),v,"."); if (v[1]+0>=22 && index(","$3",", ","k",")) { print $1; exit } }')"
    [ -n "$ver" ] || fail "Could not find a Node 22 or later download. Install Node LTS from https://nodejs.org and run this again."
    say "Downloading Node $ver."
    get_tar "https://nodejs.org/dist/$ver/node-$ver-$os-$arch.tar.gz" "$ROOT/node"
    NODE="$ROOT/node/bin/node"
  fi
  NPM="$(dirname "$NODE")/npm"
  export PATH="$(dirname "$NODE"):$PATH"

  # ------------------------------------------------------------ stop a running Workshop before updating it
  local port; port="$("$NODE" -p 'try { JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.workshop/config.json","utf8")).port || 4380 } catch { 4380 }')"
  health() { curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null | grep -q workshop-agent; }
  if health; then
    step "Stopping Workshop so it can be updated"
    [ "$os" = darwin ] && launchctl bootout "gui/$(id -u)/org.workshop.agent" 2>/dev/null || true
    if command -v lsof >/dev/null 2>&1; then lsof -ti "tcp:$port" -sTCP:LISTEN | xargs kill 2>/dev/null || true; fi
    sleep 1
    health && fail "Workshop is running on port $port and could not be stopped. Close it, then run this again."
  fi

  # ------------------------------------------------------------ 2. Workshop and Tandem
  for name in workshop eng-agents; do
    [ "$name" = workshop ] && step "Workshop" || step "Tandem (eng-agents)"
    local dir="$ROOT/$name" url="https://github.com/adavidson21/$name"
    if [ -d "$dir/.git" ]; then
      if command -v git >/dev/null 2>&1; then say "Updating your git checkout."; git -C "$dir" pull --ff-only
      else say "This is a git checkout and git is not on PATH, so it is left as it is."; fi
      continue
    fi
    if [ -d "$dir" ]; then rm -rf "$dir.previous"; mv "$dir" "$dir.previous"; say "Kept the old copy at $dir.previous."; fi
    say "Downloading the latest from $url."
    get_tar "$url/archive/refs/heads/main.tar.gz" "$dir"
  done

  # ------------------------------------------------------------ 3. opencode
  step "opencode"
  OPENCODE=""
  local found=""; found="$(command -v opencode 2>/dev/null || true)"
  if [ -n "$found" ] && [ "${found#"$ROOT/opencode"}" = "$found" ]; then OPENCODE="$found"; say "Using your opencode at $found."
  else
    [ -n "$found" ] && say "Updating opencode." || say "Installing opencode."
    "$NPM" install --global --prefix "$ROOT/opencode" --no-fund --no-audit opencode-ai@latest \
      || fail "npm could not install opencode. Install it from https://opencode.ai, then run this again."
    OPENCODE="$ROOT/opencode/bin/opencode"
  fi

  # ------------------------------------------------------------ 4. PowerShell 7
  step "PowerShell 7"
  PWSH=""
  if command -v pwsh >/dev/null 2>&1; then PWSH="$(command -v pwsh)"; say "Using your pwsh at $PWSH."
  elif [ -x "$ROOT/pwsh/pwsh" ]; then PWSH="$ROOT/pwsh/pwsh"; say "Using Workshop's pwsh."
  else
    local asset; asset="$(curl -fsSL https://api.github.com/repos/PowerShell/PowerShell/releases/latest \
      | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).assets.find(x=>x.name.endsWith(process.argv[1]));console.log(a?a.browser_download_url:"")})' "-$psos-$arch.tar.gz")"
    [ -n "$asset" ] || fail "Could not find a PowerShell download. Install PowerShell 7 (pwsh), then run this again."
    say "Downloading PowerShell."
    rm -rf "$ROOT/pwsh"; mkdir -p "$ROOT/pwsh"
    curl -fsSL "$asset" | tar -xz -C "$ROOT/pwsh"
    chmod +x "$ROOT/pwsh/pwsh"
    PWSH="$ROOT/pwsh/pwsh"
  fi

  # A workshop command for new terminals: workshop open, workshop doctor, and so on.
  mkdir -p "$ROOT/bin"
  printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$NODE" "$ROOT/workshop/workshop.mjs" > "$ROOT/bin/workshop"
  chmod +x "$ROOT/bin/workshop"

  # Put Workshop's own tools on PATH for new terminals (one marked block, replaced on every run).
  local line="export PATH=\"$ROOT/bin:$ROOT/opencode/bin:$ROOT/pwsh:$ROOT/node/bin:\$PATH\""
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    # Always keep .profile; on a Mac also .zshrc (zsh is the default shell); others only if they exist.
    [ -f "$rc" ] || [ "$rc" = "$HOME/.profile" ] || { [ "$os" = darwin ] && [ "$rc" = "$HOME/.zshrc" ]; } || continue
    local tmp; tmp="$(mktemp)"
    { [ -f "$rc" ] && sed '/# >>> workshop >>>/,/# <<< workshop <<</d' "$rc"; printf '# >>> workshop >>>\n%s\n# <<< workshop <<<\n' "$line"; } > "$tmp"
    mv "$tmp" "$rc"
  done

  # ------------------------------------------------------------ 5. Tandem into opencode
  step "Installing Tandem into opencode"
  local targs=(-NoProfile -File "$ROOT/eng-agents/install.ps1")
  if [ -d "$HOME/.config/eng-agents/personal" ]; then targs+=(-Personal "$HOME/.config/eng-agents/personal"); say "Using your personal layer at ~/.config/eng-agents/personal."; fi
  "$PWSH" "${targs[@]}" || fail "Tandem install failed. See the messages above."

  # ------------------------------------------------------------ 6. Workshop setup
  step "Setting up Workshop"
  mkdir -p "${WORKSPACE/#\~/$HOME}"
  # Absolute commands: Workshop started at login gets a short PATH that may not include them.
  "$NODE" "$ROOT/workshop/workshop.mjs" install --login --allow "$SITE" --workspace "$WORKSPACE" --opencode "$OPENCODE" --powershell "$PWSH" \
    || fail "Workshop setup failed. See the messages above."

  # ------------------------------------------------------------ 7. start and sign in
  step "Starting Workshop"
  if [ "$os" = darwin ]; then
    local plist="$HOME/Library/LaunchAgents/org.workshop.agent.plist"
    launchctl bootout "gui/$(id -u)/org.workshop.agent" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || launchctl load -w "$plist"
  elif command -v setsid >/dev/null 2>&1; then
    setsid -f "$NODE" "$ROOT/workshop/agent/start.mjs" --quiet >/dev/null 2>&1 < /dev/null
  else
    nohup "$NODE" "$ROOT/workshop/agent/start.mjs" --quiet >/dev/null 2>&1 < /dev/null &
  fi
  local i=0; until health || [ $i -ge 40 ]; do sleep 0.5; i=$((i+1)); done
  health || fail "Workshop did not start. Run: \"$NODE\" \"$ROOT/workshop/workshop.mjs\" start  to see why."
  "$NODE" "$ROOT/workshop/workshop.mjs" open >/dev/null || true

  command -v git >/dev/null 2>&1 || printf '\n\033[33mNote: git is not installed. Tandem needs it to make branches and pull requests: https://git-scm.com/downloads\033[0m\n'
  printf '\n\033[32mDone. Workshop is running and starts when you log in.\033[0m\n'
  echo "Workshop opened in your browser once to sign it in. Go back to $SITE and click Connect."
  echo "Using a different browser for Dispatch? Run  workshop open --print  in a new terminal and open that address there."
  echo "Your work goes in $WORKSPACE. Change it any time in Dispatch, under opencode settings."
}

# Everything is in main, so a download cut off halfway runs nothing.
main "$@"
