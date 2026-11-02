#!/usr/bin/env bash
# Workshop and Tandem one-line installer for macOS and Linux. Per user, no admin rights, no sudo.
#
#   curl -fsSL https://dispatch.alexisdavidson.org/install.sh | bash
#
# The site serves this file with {{SITE}} filled in (worker/index.js), so Workshop allows the site it came from.
# What it does, all inside ~/.local/share/workshop unless something is already installed:
#   1. Node 22.15 or later: uses yours, or downloads a private copy.
#   2. Workshop and Tandem (eng-agents): downloads the latest from GitHub. No git needed for this.
#   3. opencode: uses yours, or installs it with npm into the Workshop folder.
#   4. git: uses yours; on a Mac, asks macOS to install its command line tools (which include git).
#      PowerShell 7 (pwsh), which Tandem runs on: uses yours, or downloads a private copy.
#   5. Installs Tandem into opencode (eng-agents install.ps1), then asks to connect an AI model
#      (opencode auth login) unless opencode already has one. WORKSHOP_SKIP_AI=1 skips the question.
#      opencode and Tandem are only for Dispatch: if either cannot be installed, the install carries on without
#      them, and running this again later adds them.
#   6. Sets up Workshop: hosted mode for this site, and the opencode connector with workspace ~/work when opencode
#      is installed. Start at login stays as it is (off on a new install); WORKSHOP_LOGIN=1 turns it on.
#   7. Starts Workshop and opens it once in your browser, which signs this browser in.
# Running it again updates everything and keeps your settings.
# Environment overrides: WORKSHOP_INSTALL_DIR, WORKSHOP_WORKSPACE, WORKSHOP_SKIP_AI, WORKSHOP_LOGIN.
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
    # 22.15 or later: from then on Node can trust the certificates the system trusts (see npm below).
    if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=15)?0:1)'; then NODE="$(command -v node)"; say "Using your Node $(node -v)."
    else say "Your Node is $(node -v); Workshop needs 22.15 or later, so it gets its own copy."; fi
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
    # A company network that inspects HTTPS uses its own certificate, which the system trusts and npm does not.
    # Node 22.15 and later can use the system certificate store for this one npm run.
    local nopts="${NODE_OPTIONS:-}"
    if "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=15)?0:1)'; then nopts="${nopts:+$nopts }--use-system-ca"; fi
    if NODE_OPTIONS="$nopts" "$NPM" install --global --prefix "$ROOT/opencode" --no-fund --no-audit opencode-ai@latest && [ -x "$ROOT/opencode/bin/opencode" ]; then
      OPENCODE="$ROOT/opencode/bin/opencode"
    elif [ -x "$ROOT/opencode/bin/opencode" ]; then
      OPENCODE="$ROOT/opencode/bin/opencode"; say "npm could not update opencode, so the copy you have stays."
    else
      printf '  \033[33mnpm could not install opencode. Workshop, Docket, Receipts and Home do not need it; Dispatch does.\033[0m\n'
      printf '  \033[33mCarrying on without it. Install it from https://opencode.ai, or run this installer again later.\033[0m\n'
    fi
  fi

  # ------------------------------------------------------------ git
  # Agents use git for branches, diffs and pushes. On a Mac, git comes with Apple's command line tools
  # (/usr/bin/git is only a stub until they are installed): ask macOS to install them. On Linux, say how.
  step "git"
  if git --version >/dev/null 2>&1; then say "Using your $(git --version | sed 's/^git version /git /')."
  elif [ "$os" = darwin ]; then
    xcode-select --install >/dev/null 2>&1 || true
    say "macOS is asking to install its command line tools, which include git. Click Install in that window."
    say "This install carries on meanwhile; agents need git before they can make branches."
  else say "git is not installed. Install it with your package manager (for example: sudo apt install git), then agents can make branches."
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
  local tandem_ok=""
  if [ -z "$OPENCODE" ]; then say "Skipped: Tandem runs in opencode, which is not installed."
  else
    local targs=(-NoProfile -File "$ROOT/eng-agents/install.ps1")
    if [ -d "$HOME/.config/eng-agents/personal" ]; then targs+=(-Personal "$HOME/.config/eng-agents/personal"); say "Using your personal layer at ~/.config/eng-agents/personal."; fi
    if "$PWSH" "${targs[@]}"; then tandem_ok=1
    else printf '  \033[33mTandem did not install (see the messages above). Carrying on; Dispatch needs it, the other apps do not.\033[0m\n'; fi
  fi

  # ------------------------------------------------------------ AI model
  # Agents need an AI provider in opencode. Ask once, unless opencode already has one (saved credentials or a
  # known API key variable). The script itself arrives on stdin, so the question reads from the terminal.
  step "AI model"
  local has_ai="" auth="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"
  if [ -s "$auth" ] && "$NODE" -e 'process.exit(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length ? 0 : 1)' "$auth" 2>/dev/null; then has_ai=1; fi
  for v in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY XAI_API_KEY DEEPSEEK_API_KEY MISTRAL_API_KEY; do
    if [ -n "$(printenv "$v" 2>/dev/null || true)" ]; then has_ai=1; fi
  done
  if [ -z "$OPENCODE" ]; then say "Skipped: opencode is not installed."
  elif [ -n "$has_ai" ]; then say "opencode already has an AI provider."
  elif [ -n "${WORKSHOP_SKIP_AI:-}" ] || ! (exec < /dev/tty) 2>/dev/null; then say "Later: run  opencode auth login  to connect an AI model. Dispatch shows how."
  else
    say "Agents need an AI model. You pick a provider and paste its API key; it stays in opencode on this computer."
    say "For Claude, pick Anthropic and use a key from https://console.anthropic.com"
    local ans=""
    printf '  Connect one now? [Y/n] '
    read -r ans < /dev/tty || ans=n
    case "$ans" in
      n|N|no|No|NO) say "Skipped. Dispatch shows how to connect one later." ;;
      *) "$OPENCODE" auth login < /dev/tty || say "Not connected. Run  opencode auth login  later; Dispatch shows how." ;;
    esac
  fi

  # ------------------------------------------------------------ 6. Workshop setup
  step "Setting up Workshop"
  local wargs=(install --allow "$SITE")
  # Start at login is opt-in: run it by hand for a while first. A setting turned on earlier is kept either way.
  [ "${WORKSHOP_LOGIN:-}" = "1" ] && wargs+=(--login)
  if [ -n "$OPENCODE" ]; then
    mkdir -p "${WORKSPACE/#\~/$HOME}"
    # Absolute commands: Workshop started at login gets a short PATH that may not include them.
    wargs+=(--workspace "$WORKSPACE" --opencode "$OPENCODE" --powershell "$PWSH")
  fi
  "$NODE" "$ROOT/workshop/workshop.mjs" "${wargs[@]}" || fail "Workshop setup failed. See the messages above."

  # ------------------------------------------------------------ 7. start and sign in
  step "Starting Workshop"
  local plist="$HOME/Library/LaunchAgents/org.workshop.agent.plist"
  if [ "$os" = darwin ] && [ -f "$plist" ]; then
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
  if "$NODE" -e 'try{process.exit(JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.workshop/config.json","utf8")).features.startAtLogin===true?0:1)}catch{process.exit(1)}'; then
    printf '\n\033[32mDone. Workshop is running and starts when you log in.\033[0m\n'
  else
    printf '\n\033[32mDone. Workshop is running.\033[0m\n'
    echo "It does not start by itself when you log in. Start it with  workshop start  in a new terminal, or turn on Start at login in Workshop on this computer (workshop open)."
  fi
  echo "Workshop opened in your browser once to sign it in. Go back to $SITE and click Connect."
  echo "Using a different browser for Dispatch? Run  workshop open --print  in a new terminal and open that address there."
  if [ -n "$OPENCODE" ] && [ -n "$tandem_ok" ]; then echo "Your work goes in $WORKSPACE. Change it any time in Dispatch, under opencode settings."
  else printf '\033[33mDispatch is not set up yet (opencode or Tandem is missing). Run this installer again when you want it.\033[0m\n'; fi
}

# Everything is in main, so a download cut off halfway runs nothing.
main "$@"
