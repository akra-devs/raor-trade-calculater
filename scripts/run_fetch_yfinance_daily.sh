#!/usr/bin/env sh
set -eu

PYTHON_BIN="${PYTHON:-python3}"

if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN=".venv/bin/python"
fi

exec "$PYTHON_BIN" scripts/fetch_yfinance_daily.py "$@"
