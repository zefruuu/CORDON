import argparse
import asyncio
import json
import os
import random
import sys
import time
from typing import Set

import serial
import serial.tools.list_ports
import websockets

WS_HOST = "localhost"
WS_PORT = 8765
BAUD_RATE = 115200
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cordon_state.json")

FLAG_SEISMIC = 1 << 0  # 1 (PIR AM312)
FLAG_RADAR   = 1 << 1  # 2 (RCWL-0516)
FLAG_METAL   = 1 << 2  # 4 (QMC5883L)
FLAG_TAMPER  = 1 << 3  # 8 (Enclosure tamper)

MSG_HEARTBEAT = 1
MSG_ALARM     = 2
MSG_TAMPER    = 3

connected_clients: Set = set()


def load_saved_nodes() -> dict | None:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "nodes" in data:
                    return data["nodes"]
        except Exception as e:
            print(f"[STATE] Failed to read {STATE_FILE}: {e}")
    return None


def save_nodes_to_disk(nodes: dict):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"nodes": nodes}, f, indent=2, ensure_ascii=False)
        print(f"[STATE] Saved {len(nodes)} sensor node(s) to cordon_state.json")
    except Exception as e:
        print(f"[STATE] Failed to write {STATE_FILE}: {e}")


async def broadcast(packet_dict: dict):
    payload = json.dumps(packet_dict)
    print(f"[TX -> WS] {payload}")
    if not connected_clients:
        return
    disconnected = set()
    for ws in list(connected_clients):
        try:
            await ws.send(payload)
        except Exception:
            disconnected.add(ws)
    connected_clients.difference_update(disconnected)


async def ws_handler(websocket):
    connected_clients.add(websocket)
    client_addr = websocket.remote_address
    print(f"[WS] Operator dashboard connected: {client_addr} (total: {len(connected_clients)})")

    saved_nodes = load_saved_nodes()
    if saved_nodes is not None:
        try:
            await websocket.send(json.dumps({"cmd": "load_state", "nodes": saved_nodes}))
        except Exception:
            pass

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                if data.get("cmd") == "save_state" and "nodes" in data:
                    save_nodes_to_disk(data["nodes"])
                else:
                    await broadcast(data)
            except json.JSONDecodeError:
                pass
    except Exception:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Operator dashboard disconnected: {client_addr}")


def find_gateway_port() -> str | None:
    ports = serial.tools.list_ports.comports()
    keywords = ("ESP32", "USB JTAG", "CP210", "CH340", "CH9102", "UART", "Serial", "USB-SERIAL")
    for p in ports:
        desc = f"{p.description} {p.manufacturer or ''}".upper()
        if any(k.upper() in desc for k in keywords):
            return p.device
    if ports:
        return ports[0].device
    return None


async def serial_reader_task(explicit_port: str | None):
    print("[SERIAL] Starting hardware gateway listener...")
    while True:
        port_name = explicit_port or find_gateway_port()
        if not port_name:
            print("[SERIAL] Waiting for ESP32-C3 Gateway USB connection...")
            await asyncio.sleep(2.0)
            continue

        try:
            ser = serial.Serial(port_name, BAUD_RATE, timeout=0.05)
            print(f"[SERIAL] Connected to Gateway on {port_name} @ {BAUD_RATE} baud")
            while True:
                if ser.in_waiting > 0:
                    raw_line = ser.readline().decode("utf-8", errors="ignore").strip()
                    if raw_line.startswith("{") and raw_line.endswith("}"):
                        try:
                            packet = json.loads(raw_line)
                            await broadcast(packet)
                        except json.JSONDecodeError:
                            print(f"[SERIAL] Malformed JSON ignored: {raw_line}")
                    elif raw_line:
                        print(f"[GATEWAY LOG] {raw_line}")
                await asyncio.sleep(0.01)
        except serial.SerialException as e:
            print(f"[SERIAL] Connection lost ({e}). Reconnecting in 2s...")
            await asyncio.sleep(2.0)


def build_packet(node_id: int, msg_type: int, flags: int, hops: int = 0) -> dict:
    return {
        "id": node_id,
        "type": msg_type,
        "flags": flags,
        "radar": 1 if (flags & FLAG_RADAR) else 0,
        "metal": 1 if (flags & FLAG_METAL) else 0,
        "bat": round(random.uniform(3.58, 3.72), 2),
        "hops": hops,
    }


def read_keypress_nonblocking() -> str | None:
    if sys.platform == "win32":
        import msvcrt
        if msvcrt.kbhit():
            ch = msvcrt.getwch()
            return ch.lower()
    return None


def print_mock_controls():
    print("\n" + "=" * 68)
    print("  CORDON TACTICAL SIMULATOR (--mock mode)")
    print("=" * 68)
    print("  Interactive Hotkeys (press directly in this terminal):")
    print("    [1] [2] [3] -> RED ALARM: Armed Intruder (PIR+RADAR+METAL) on Node 1/2/3")
    print("    [4] [5] [6] -> ORANGE ALARM: Bio-Target (PIR+RADAR) on Node 1/2/3")
    print("    [7] [8] [9] -> YELLOW WARNING: Thermal Contact (PIR only) on Node 1/2/3")
    print("    [H]         -> Send HEARTBEAT (Battery OK) for Nodes 1, 2, 3")
    print("    [T]         -> Send TAMPER / Enclosure Breach alarm")
    print("    [A]         -> Toggle Auto-Patrol Scenario ON / OFF")
    print("    [Q]         -> Quit simulator")
    print("=" * 68 + "\n")


async def mock_simulator_task():
    print_mock_controls()
    auto_mode = True
    last_auto_time = time.monotonic()
    auto_step = 0

    scenario_steps = [
        (1, MSG_HEARTBEAT, 0, 0),
        (2, MSG_HEARTBEAT, 0, 1),
        (3, MSG_HEARTBEAT, 0, 1),
        (1, MSG_ALARM, FLAG_SEISMIC, 0),
        (1, MSG_ALARM, FLAG_SEISMIC | FLAG_RADAR, 0),
        (2, MSG_ALARM, FLAG_SEISMIC | FLAG_RADAR | FLAG_METAL, 1),
        (3, MSG_ALARM, FLAG_SEISMIC | FLAG_RADAR | FLAG_METAL, 1),
    ]

    while True:
        key = read_keypress_nonblocking()
        if key:
            if key in ("1", "2", "3"):
                nid = int(key)
                flags = FLAG_SEISMIC | FLAG_RADAR | FLAG_METAL
                hops = 1 if nid > 1 else 0
                await broadcast(build_packet(nid, MSG_ALARM, flags, hops))
            elif key in ("4", "5", "6"):
                nid = int(key) - 3
                flags = FLAG_SEISMIC | FLAG_RADAR
                hops = 1 if nid > 1 else 0
                await broadcast(build_packet(nid, MSG_ALARM, flags, hops))
            elif key in ("7", "8", "9"):
                nid = int(key) - 6
                flags = FLAG_SEISMIC
                await broadcast(build_packet(nid, MSG_ALARM, flags, 0))
            elif key == "h":
                for nid in (1, 2, 3):
                    await broadcast(build_packet(nid, MSG_HEARTBEAT, 0, 1 if nid > 1 else 0))
                    await asyncio.sleep(0.15)
            elif key == "t":
                await broadcast(build_packet(2, MSG_TAMPER, FLAG_TAMPER, 1))
            elif key == "a":
                auto_mode = not auto_mode
                state_str = "ENABLED" if auto_mode else "PAUSED (Manual keys only)"
                print(f"[MOCK] Auto-Patrol Scenario: {state_str}")
                last_auto_time = time.monotonic()
            elif key == "q":
                print("[MOCK] Exiting...")
                sys.exit(0)

        now = time.monotonic()
        if auto_mode and (now - last_auto_time >= 5.0):
            last_auto_time = now
            nid, mtype, flags, hops = scenario_steps[auto_step % len(scenario_steps)]
            auto_step += 1
            await broadcast(build_packet(nid, mtype, flags, hops))

        await asyncio.sleep(0.05)


async def main():
    parser = argparse.ArgumentParser(description="CORDON Serial-to-WebSocket Bridge")
    parser.add_argument("--mock", action="store_true", help="Run tactical simulator without hardware")
    parser.add_argument("--port", type=str, default=None, help="Explicit COM port (e.g. COM3)")
    args = parser.parse_args()

    print(f"[BRIDGE] Starting WebSocket Server on ws://{WS_HOST}:{WS_PORT}")
    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        if args.mock:
            await mock_simulator_task()
        else:
            await serial_reader_task(args.port)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[BRIDGE] Stopped by operator.")
