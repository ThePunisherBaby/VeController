#!/usr/bin/env bash
# Prepara el Codespace para la app de Electron (tenveo_electron): instala las
# dependencias y deja todo listo para correr las pruebas y la versión web.
set -euo pipefail

echo "==> Dependencias del sistema"
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends python3 python3-websockets

echo "==> Dependencias de la app"
cd tenveo_electron
npm ci --no-audit --no-fund

cat <<'EOF'

Listo. Dentro de la carpeta tenveo_electron:
  npm test                          corre las pruebas automáticas
  npm run web -- --host 0.0.0.0     levanta la versión web en el puerto 8765

En el Codespace no hay PC500 ni OBS. Abre el puerto 8765 y agrega ?demo a la
dirección para usar la consola con los simuladores.
EOF
