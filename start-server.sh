#!/bin/bash
set -e

cd "$SCRIPT_DIR"
source ~/myvenv/bin/activate
cd ~/swissalpine
exec python3 server.py