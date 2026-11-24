#!/bin/bash
# Installs (or updates) Reservation Sniper into ~/ReservationSniper and puts a launcher on the Desktop.
# Run it again any time to update; your settings and OpenTable login are kept.
set -euo pipefail

APP="$HOME/ReservationSniper"
REPO="hsiebel/resy-booking-bot"
BRANCH="claude/resy-reservation-bot-qbI13"
NODE_VERSION="v22.12.0"

echo "Installing Reservation Sniper..."

if [ "$(uname -s)" = "Darwin" ] && [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  echo "Google Chrome is needed. Opening the download page: install Chrome, then paste the same line again."
  open "https://www.google.com/chrome/"
  exit 1
fi

mkdir -p "$APP"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The app itself (keeps your settings and login).
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$tmp"
rsync -a --exclude config.json --exclude .chrome-profile --exclude node_modules --exclude node "$tmp"/*/opentable/ "$APP/"

# A private copy of Node.js, so nothing else needs installing.
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"; case "$arch" in arm64|aarch64) arch=arm64 ;; *) arch=x64 ;; esac
if [ "$("$APP/node/bin/node" --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  echo "Downloading Node.js $NODE_VERSION..."
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$os-$arch.tar.gz" | tar -xz -C "$tmp"
  rm -rf "$APP/node"
  mv "$tmp/node-$NODE_VERSION-$os-$arch" "$APP/node"
fi
export PATH="$APP/node/bin:$PATH"
(cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

# Double-click launcher. caffeinate keeps the Mac awake while the app is open.
mkdir -p "$HOME/Desktop"
LAUNCHER="$HOME/Desktop/Reservation Sniper.command"
cat > "$LAUNCHER" <<EOF
#!/bin/bash
cd "$APP"
if command -v caffeinate >/dev/null; then exec caffeinate -i "$APP/node/bin/node" src/app.mjs; fi
exec "$APP/node/bin/node" src/app.mjs
EOF
chmod +x "$LAUNCHER"

echo ""
echo "Done. From now on, double-click \"Reservation Sniper\" on your Desktop to open it."
if [ -z "${NO_OPEN:-}" ] && command -v open >/dev/null; then open "$LAUNCHER"; fi
