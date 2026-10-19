#!/usr/bin/env bash
# Install Workshop on macOS or Linux, per user, no admin rights.
# It checks Node, creates ~/.workshop, and (unless you pass --no-login) turns on start at login.
# Run it from anywhere:  bash scripts/install.sh   [--no-login]
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

# Create ~/.workshop and turn on start at login (pass --no-login to skip that part).
node "$REPO/workshop.mjs" install "$@"

echo
echo "Start Workshop now with:  node \"$REPO/workshop.mjs\" start"
echo "Then open the address it prints in Chrome or Edge on this computer."
echo "See docs/security.md for what Workshop stores and where."
