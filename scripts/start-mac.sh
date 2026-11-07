#!/usr/bin/env bash
# Lance Synthia sur macOS. Usage : ./scripts/start-mac.sh  (ou double-clic sur start-mac.command)
set -e
cd "$(dirname "$0")/.."

node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; }

if ! node_ok; then
  echo "Node 22 ou plus est introuvable."
  if command -v brew >/dev/null 2>&1; then
    read -r -p "L'installer avec Homebrew (brew install node@22) ? [o/N] " a
    if [[ "$a" =~ ^[oOyY]$ ]]; then
      brew install node@22
      export PATH="$(brew --prefix node@22)/bin:$PATH"
      echo "Si 'node' n'est pas trouvé plus tard : brew link --overwrite node@22"
    else
      echo "Installe Node 22+ (https://nodejs.org) puis relance."; exit 1
    fi
  else
    echo "Installe Node 22+ depuis https://nodejs.org (ou installe Homebrew), puis relance."; exit 1
  fi
fi

node scripts/setup.js
npm install
echo "Synthia démarre sur http://localhost:3000 (Ctrl+C pour arrêter)"
(sleep 2 && open http://localhost:3000) >/dev/null 2>&1 &
exec node server/index.js
