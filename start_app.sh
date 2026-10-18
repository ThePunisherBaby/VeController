#!/bin/bash
# ==============================================================================
# TENVEO PC500 STUDIO LINK + OBS COMPANION LAUNCHER
#
#   ./start_app.sh            Abre la app de Electron. Todo va por la red.
#   ./start_app.sh --web      Abre la versión web en el navegador (por la IP del PC500).
#   ./start_app.sh --flutter  Abre la app anterior de Flutter y el puente USB.
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"
ELECTRON_DIR="$DIR/tenveo_electron"
MODE="${1:-app}"

# VS Code y otras herramientas dejan puesta esta variable, que haría correr
# Electron como si fuera Node.
unset ELECTRON_RUN_AS_NODE

echo "======================================================"
echo "  TENVEO PC500 + OBS STUDIO COMPANION"
echo "======================================================"

forward_usb() {
    if ! command -v adb &> /dev/null; then
        echo "  Aviso: adb no está instalado. Se usará solo Ethernet."
        echo "  Para USB: brew install android-platform-tools"
        return
    fi
    if adb forward tcp:8089 tcp:8089 2>/dev/null; then
        adb forward tcp:8080 tcp:80 2>/dev/null
        echo "  Puente USB activo (WebSocket: 8089, panel web: 8080)."
    else
        echo "  Aún no se ve el PC500 por USB. El puente seguirá intentando."
    fi
}

case "$MODE" in
    --web|web)
        if ! command -v node &> /dev/null; then
            echo "  Falta Node.js. Instálalo desde https://nodejs.org o con: brew install node"
            exit 1
        fi
        echo "[1/2] Levantando la consola web en el puerto 8765..."
        node "$ELECTRON_DIR/scripts/serve-web.mjs" --port 8765 > /dev/null 2>&1 &
        SERVER_PID=$!
        trap 'kill $SERVER_PID 2>/dev/null; exit' INT TERM EXIT
        sleep 1
        echo "[2/2] Abriendo el navegador..."
        open "http://localhost:8765"
        echo ""
        echo "  CONSOLA WEB ACTIVA EN: http://localhost:8765"
        echo "  Escribe la IP del PC500 en los ajustes (arriba a la derecha)."
        echo "  El video del PC500 solo se ve en la app de escritorio."
        echo "  Presiona Ctrl+C en esta terminal para detener."
        wait $SERVER_PID
        ;;

    --flutter|flutter)
        APP_PATH="$DIR/tenveo_app/build/TenveoStudio.app"
        if [ ! -d "$APP_PATH" ]; then
            echo "  No se encontró la app de Flutter en $APP_PATH"
            exit 1
        fi
        echo "[1/2] Preparando el puente USB..."
        forward_usb
        echo "[2/2] Abriendo la app de Flutter y manteniendo el puente USB..."
        open "$APP_PATH"
        echo "  Presiona Ctrl+C para cerrar el puente."
        python3 "$DIR/tenveo_bridge.py"
        ;;

    *)
        for APP in \
            "/Applications/Tenveo Studio.app" \
            "$ELECTRON_DIR/dist/mac-universal/Tenveo Studio.app" \
            "$ELECTRON_DIR/dist/mac/Tenveo Studio.app" \
            "$ELECTRON_DIR/dist/mac-arm64/Tenveo Studio.app"; do
            if [ -d "$APP" ]; then
                echo "  Abriendo $APP"
                open "$APP"
                exit 0
            fi
        done

        echo "  No hay una app empaquetada. Abriendo desde el código fuente..."
        if ! command -v npm &> /dev/null; then
            echo "  Falta Node.js. Instálalo desde https://nodejs.org o con: brew install node"
            exit 1
        fi
        if [ ! -d "$ELECTRON_DIR/node_modules" ]; then
            echo "  Instalando dependencias (solo la primera vez)..."
            (cd "$ELECTRON_DIR" && npm install) || exit 1
        fi
        cd "$ELECTRON_DIR" && exec npm start
        ;;
esac
