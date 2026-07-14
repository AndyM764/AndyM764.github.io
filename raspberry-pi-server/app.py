from __future__ import annotations

import socket
from typing import Any

from flask import Flask, jsonify, request


HOST = "0.0.0.0"
PORT = 5000

app = Flask(__name__)


def get_network_ip() -> str:
    """Return the Raspberry Pi LAN IP when available."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe_socket:
            probe_socket.connect(("8.8.8.8", 80))
            return probe_socket.getsockname()[0]
    except OSError:
        return "127.0.0.1"


@app.get("/status")
def status() -> tuple[Any, int]:
    return jsonify({"status": "ok"}), 200


@app.post("/data")
def data() -> tuple[Any, int]:
    payload = request.get_json(silent=True)
    print(f"Received JSON: {payload}", flush=True)
    return jsonify({"received": True}), 200


if __name__ == "__main__":
    network_ip = get_network_ip()
    print(f"CourtVision2 Raspberry Pi server listening on http://{network_ip}:{PORT}", flush=True)
    app.run(host=HOST, port=PORT)
