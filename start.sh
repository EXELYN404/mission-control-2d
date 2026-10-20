#!/bin/bash
# ============================================
# Mission Control 2D — Start Script
# ============================================
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════════╗"
echo "║     MISSION CONTROL 2D — STARTING       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 tidak ditemukan!"
    exit 1
fi

# Start server
python3 server.py --host 127.0.0.1 --port 3000
