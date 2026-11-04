#!/usr/bin/env bash
# Install Workshop on macOS or Linux, per user, no admin rights.
# It checks Node and creates ~/.workshop. Start at login stays off unless you pass --login.
# Run it from anywhere:  bash scripts/install.sh   [--login]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Workshop needs Node 22 or later, and node is not on your PATH."
  echo "Install Node 22 LTS from https://nodejs.org, then run this again."
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then
  echo "Workshop needs Node 22 or later. You have $(node -v)."
  echo "Update Node from https://nodejs.org, then run this again."
  exit 1
fi
echo "Node $(node -v): ok."

# Create ~/.workshop (pass --login to also turn on start at login, --work-mode for work mode).
WORK=0
for a in "$@"; do [ "$a" = "--work-mode" ] && WORK=1; done
node "$REPO/workshop.mjs" install "$@"
if [ "$WORK" = 1 ]; then
  node "$REPO/workshop.mjs" pin || { echo "Building the pinned copy failed. See the messages above."; exit 1; }
fi

# A workshop command in ~/.workshop/bin, like the one-line installer.
mkdir -p "$HOME/.workshop/bin"
printf '#!/bin/sh\nexec "%s" "%s/workshop.mjs" "$@"\n' "$(command -v node)" "$REPO" > "$HOME/.workshop/bin/workshop"
chmod +x "$HOME/.workshop/bin/workshop"

echo
case ":$PATH:" in *":$HOME/.workshop/bin:"*) ;; *) echo "Add the workshop command to your PATH:  export PATH=\"\$HOME/.workshop/bin:\$PATH\"  (in ~/.zshrc or ~/.bashrc)";; esac
echo "Start Workshop now with:  workshop start   (or node \"$REPO/workshop.mjs\" start)"
if [ "$WORK" = 1 ]; then
  echo "Then run:  workshop open   Workshop opens on this computer from the pinned copy. There is no Connect step in work mode."
  echo "Finish with:  workshop doctor   and continue when it ends with: Result: all good."
else
  echo "Then open the address it prints in Chrome or Edge on this computer, to sign in."
  echo "After that, open https://workshop.alexisdavidson.org in the same browser and click Connect."
fi
echo "See docs/security.md for what Workshop stores and where."
