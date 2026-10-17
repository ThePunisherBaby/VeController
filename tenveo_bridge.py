#!/usr/bin/env python3
"""
Tenveo PC500 Bridge Helper
===========================
Este script se ejecuta en background junto con la web app.
Hace el adb forward del puerto 8089 del PC500 al localhost para que
el navegador pueda conectar via WebSocket.

Uso:
  python3 tenveo_bridge.py

Requisitos:
  - adb instalado y en PATH
  - PC500 conectado por USB
"""

import subprocess
import sys
import time
import signal

def setup_adb_forward():
    """Configura el reenvio ADB del puerto WebSocket del PC500."""
    try:
        result = subprocess.run(
            ['adb', 'forward', 'tcp:8089', 'tcp:8089'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            print("[Bridge] ✅ ADB forward configurado: localhost:8089 -> PC500:8089")
            return True
        else:
            print(f"[Bridge] ⚠️  ADB forward falló: {result.stderr.strip()}")
            return False
    except FileNotFoundError:
        print("[Bridge] ❌ 'adb' no encontrado. Instala Android SDK Platform Tools.")
        return False
    except subprocess.TimeoutExpired:
        print("[Bridge] ⚠️  ADB forward timeout.")
        return False

def check_adb_device():
    """Verifica que el PC500 esté conectado por USB."""
    try:
        result = subprocess.run(
            ['adb', 'devices'],
            capture_output=True, text=True, timeout=5
        )
        lines = result.stdout.strip().split('\n')
        devices = [l for l in lines[1:] if 'device' in l and 'unauthorized' not in l]
        if devices:
            print(f"[Bridge] 📱 Dispositivos ADB detectados: {len(devices)}")
            for d in devices:
                print(f"         → {d.strip()}")
            return True
        else:
            print("[Bridge] ⏳ No se detecta dispositivo ADB. Esperando...")
            return False
    except Exception as e:
        print(f"[Bridge] Error verificando ADB: {e}")
        return False

def main():
    print("=" * 55)
    print("  TENVEO PC500 — Bridge Helper para Web App")
    print("=" * 55)
    print()
    print("Este script mantiene activo el puente USB → localhost")
    print("para que la Web App pueda comunicarse con el PC500.")
    print()
    print("Presiona Ctrl+C para detener.\n")

    def signal_handler(sig, frame):
        print("\n[Bridge] 🛑 Detenido por el usuario.")
        # Limpiar el forward
        try:
            subprocess.run(['adb', 'forward', '--remove', 'tcp:8089'],
                         capture_output=True, timeout=3)
            print("[Bridge] 🧹 Forward ADB limpiado.")
        except Exception:
            pass
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)

    forwarded = False
    while True:
        if not forwarded:
            if check_adb_device():
                forwarded = setup_adb_forward()
            else:
                print("[Bridge] Reintentando en 5 segundos...\n")
        else:
            # Verificar que el dispositivo siga conectado
            if not check_adb_device():
                forwarded = False
                print("[Bridge] 🔌 Dispositivo desconectado. Esperando reconexión...")
            else:
                # Refrescar el forward por si se perdió
                setup_adb_forward()

        time.sleep(5)

if __name__ == '__main__':
    main()
