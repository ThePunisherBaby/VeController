#!/usr/bin/env python3
"""
Tenveo PC500 Switcher Controller
Controlador por WebSocket (a traves de USB via ADB forward o por Ethernet/IP).
"""

import asyncio
import json
import sys
import websockets

DEFAULT_WS_URI = "ws://127.0.0.1:8089"

class TenveoPC500:
    def __init__(self, uri=DEFAULT_WS_URI):
        self.uri = uri
        self.ws = None

    async def connect(self):
        self.ws = await websockets.connect(self.uri)
        # Leer estado inicial
        initial_msg = await asyncio.wait_for(self.ws.recv(), timeout=2.0)
        return json.loads(initial_msg)

    async def send_command(self, cmd_dict):
        if not self.ws:
            raise RuntimeError("No conectado al switcher")
        msg = json.dumps(cmd_dict)
        await self.ws.send(msg)

    async def select_camera(self, cam_num):
        """Selecciona entrada 1 a 4 o 'aux' en Preview (PVW)"""
        key = f"pvw-{cam_num}"
        await self.send_command({key: 1})

    async def cut(self):
        """Ejecuta transicion directa (CUT) de PVW a PGM"""
        await self.send_command({"cut": 1})

    async def auto(self):
        """Ejecuta transicion automatica (AUTO)"""
        await self.send_command({"auto": 1})

    async def ftb(self):
        """Fade To Black"""
        await self.send_command({"ftb": 1})

    async def set_audio_volume(self, channel, volume_db):
        """Ajusta volumen (ej. channel='pgm', 'in1', 'in2', etc.)"""
        key = f"audio_{channel}_vol"
        await self.send_command({key: int(volume_db)})

    async def close(self):
        if self.ws:
            await self.ws.close()

async def main():
    if len(sys.argv) < 2:
        print("Uso:")
        print("  python3 tenveo_controller.py cam <1|2|3|4|aux>")
        print("  python3 tenveo_controller.py cut")
        print("  python3 tenveo_controller.py auto")
        print("  python3 tenveo_controller.py ftb")
        print("  python3 tenveo_controller.py switch <1|2|3|4>   (Selecciona y hace CUT)")
        print("  python3 tenveo_controller.py status")
        return

    cmd = sys.argv[1].lower()
    controller = TenveoPC500()

    try:
        status = await controller.connect()
    except Exception as e:
        print(f"Error conectando al Tenveo PC500 en {controller.uri}: {e}")
        print("Asegurate de tener el reenvio activo: 'adb forward tcp:8089 tcp:8089'")
        return

    if cmd == "status":
        print("=== ESTADO ACTUAL DEL TENVEO PC500 ===")
        for k in ["pvw-1", "pvw-2", "pvw-3", "pvw-4", "pvw-aux", "auto", "cut", "mode"]:
            print(f"  {k:10}: {status.get(k, 'N/A')}")
        print(f"  Audio PGM : {status.get('audio_pgm_vol', 'N/A')} dB")

    elif cmd == "cam":
        cam = sys.argv[2]
        print(f"Seleccionando Camara {cam} en Preview...")
        await controller.select_camera(cam)
        print("Listo.")

    elif cmd == "cut":
        print("Ejecutando CUT...")
        await controller.cut()
        print("Listo.")

    elif cmd == "auto":
        print("Ejecutando AUTO...")
        await controller.auto()
        print("Listo.")

    elif cmd == "ftb":
        print("Ejecutando FTB (Fade to black)...")
        await controller.ftb()
        print("Listo.")

    elif cmd == "switch":
        cam = sys.argv[2]
        print(f"Cambiando en vivo a Camara {cam} (Preview + CUT)...")
        await controller.select_camera(cam)
        await asyncio.sleep(0.2)
        await controller.cut()
        print(f"Camara {cam} ahora esta al aire en PGM.")

    await controller.close()

if __name__ == "__main__":
    asyncio.run(main())
