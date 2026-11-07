#!/usr/bin/env bash
# Lance Synthia sur Ubuntu / Debian. Usage : ./scripts/start-ubuntu.sh
set -e
cd "$(dirname "$0")/.."

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }

if ! node_ok; then
  echo "Node 22 ou plus est introuvable."
  read -r -p "L'installer via NodeSource (utilise sudo, ajoute un dépôt apt) ? [o/N] " a
  if [[ "$a" =~ ^[oOyY]$ ]]; then
    sudo apt-get update && sudo apt-get install -y curl ca-certificates
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "Installe Node 22+ (https://nodejs.org) puis relance ce script."; exit 1
  fi
fi

node scripts/setup.js
npm install
echo "Synthia démarre sur http://localhost:3000 (Ctrl+C pour arrêter)"
exec node server/index.js
