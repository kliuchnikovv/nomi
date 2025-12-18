#!/bin/bash
# Start healthcheck server in background
python healthcheck.py &

# Start main application
exec uvicorn app:app --host :: --port ${PORT:-7777}
