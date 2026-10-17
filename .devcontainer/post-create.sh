#!/usr/bin/env bash
# Prepara el Codespace: instala la misma version de Flutter que la Mac de
# desarrollo, las dependencias del sistema y los paquetes de la app.
set -euo pipefail

FLUTTER_VERSION="${FLUTTER_VERSION:-3.47.5}"
FLUTTER_HOME="$HOME/flutter"

echo "==> Dependencias del sistema"
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends \
  curl git unzip xz-utils zip libglu1-mesa python3 python3-websockets

echo "==> Flutter $FLUTTER_VERSION"
if [ ! -x "$FLUTTER_HOME/bin/flutter" ]; then
  git clone --depth 1 --branch "$FLUTTER_VERSION" \
    https://github.com/flutter/flutter.git "$FLUTTER_HOME"
fi
export PATH="$FLUTTER_HOME/bin:$PATH"

flutter --disable-analytics >/dev/null 2>&1 || true
flutter precache --web
flutter --version

echo "==> Paquetes de la app"
(cd tenveo_app && flutter pub get)

cat <<'EOF'

Listo. Para probar la version web dentro del Codespace:
  cd tenveo_app
  flutter run -d web-server --web-hostname 0.0.0.0 --web-port 8765

Para correr las pruebas:
  cd tenveo_app && flutter test
EOF
