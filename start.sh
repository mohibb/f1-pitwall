#!/bin/bash

# F1 Pit Wall — startup script
# Usage: ./start.sh

cd "$(dirname "$0")"

echo "🏎  Starting F1 Pit Wall..."

# Activate virtual environment
source .venv/bin/activate

# Start Uvicorn in background
uvicorn main:app --host 127.0.0.1 --port 8000 &
UVICORN_PID=$!
echo "✓ Uvicorn started (PID $UVICORN_PID)"

# Wait a moment for Uvicorn to be ready
sleep 2

# Start Cloudflare tunnel in background
cloudflared tunnel run f1-pitwall &
CLOUDFLARED_PID=$!
echo "✓ Cloudflare tunnel started (PID $CLOUDFLARED_PID)"

echo ""
echo "✓ F1 Pit Wall is running at https://f1.mohibb.com"
echo "  Press Ctrl+C to stop."
echo ""

# Trap Ctrl+C and kill both processes cleanly
trap "echo ''; echo 'Shutting down...'; kill $UVICORN_PID $CLOUDFLARED_PID 2>/dev/null; exit 0" INT

# Keep script alive
wait
