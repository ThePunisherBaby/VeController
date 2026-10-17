#!/bin/bash
# ==============================================================================
# TENVEO PC500 STUDIO LINK + OBS COMPANION LAUNCHER
# Plug & Play: USB + Ethernet
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "======================================================"
echo "  TENVEO PC500 + OBS STUDIO COMPANION"
echo "  Iniciando conexion Plug & Play..."
echo "======================================================"

# 1. Preparar puente ADB USB
echo "[1/3] Verificando conexión USB..."
if command -v adb &> /dev/null; then
    adb forward tcp:8089 tcp:8089 2>/dev/null
    adb forward tcp:8080 tcp:80 2>/dev/null
    echo "      Puente USB activo (WebSocket: 8089, Web: 8080)."
else
    echo "      Aviso: adb no encontrado en PATH, continuando en modo Ethernet LAN."
fi

MODE="${1:-app}"

if [ "$MODE" = "--web" ] || [ "$MODE" = "web" ]; then
    PORT=8765
    echo "[2/3] Levantando consola Web en puerto $PORT..."
    python3 -m http.server $PORT --directory "$DIR/tenveo_app/build/web" > /dev/null 2>&1 &
    SERVER_PID=$!
    trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM EXIT
    echo "[3/3] Abriendo navegador..."
    sleep 1
    open "http://localhost:$PORT"
    echo ""
    echo "======================================================"
    echo "  CONSOLA WEB ACTIVA EN: http://localhost:$PORT"
    echo "  Presiona Ctrl+C en esta terminal para detener."
    echo "======================================================"
    wait $SERVER_PID
else
    APP_PATH="$DIR/tenveo_app/build/TenveoStudio.app"
    if [ -d "$APP_PATH" ]; then
        echo "[2/3] Lanzando aplicación nativa de macOS (TenveoStudio.app)..."
        open "$APP_PATH"
        echo "[3/3] Manteniendo puente USB/ADB en background..."
        echo ""
        echo "======================================================"
        echo "  APLICACIÓN NATIVA EN EJECUCIÓN (TenveoStudio.app)"
        echo "  (Usa './start_app.sh --web' si prefieres abrirla en navegador)"
        echo "  Presiona Ctrl+C para cerrar el launcher."
        echo "======================================================"
        # Ejecutar bridge helper para monitorear reconexión USB si se desconecta
        python3 "$DIR/tenveo_bridge.py"
    else
        echo "      Aviso: TenveoStudio.app no encontrada, abriendo versión web..."
        PORT=8765
        python3 -m http.server $PORT --directory "$DIR/tenveo_app/build/web" > /dev/null 2>&1 &
        SERVER_PID=$!
        trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM EXIT
        sleep 1
        open "http://localhost:$PORT"
        wait $SERVER_PID
    fi
fi
