#!/usr/bin/env python3
"""Fetch daily OHLC data from Yahoo Finance through yfinance.

The React app is browser-only, so it cannot import Python packages directly.
This script writes static JSON files under public/market-data for the app to load.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_DIR = Path("public/market-data")


def main() -> int:
  parser = argparse.ArgumentParser(
    description="Fetch daily stock or ETF OHLC data with yfinance.",
  )
  parser.add_argument(
    "--symbols",
    nargs="+",
    default=["TQQQ", "SOXL"],
    help="Ticker symbols to fetch. Default: TQQQ SOXL",
  )
  parser.add_argument(
    "--period",
    default="2y",
    help="yfinance period such as 6mo, 1y, 2y, 5y, max. Ignored when --start is set.",
  )
  parser.add_argument(
    "--start",
    default=None,
    help="Inclusive start date in YYYY-MM-DD format.",
  )
  parser.add_argument(
    "--end",
    default=None,
    help="Exclusive end date in YYYY-MM-DD format.",
  )
  parser.add_argument(
    "--output-dir",
    default=str(DEFAULT_OUTPUT_DIR),
    help="Directory for JSON output files. Default: public/market-data",
  )
  parser.add_argument(
    "--raw",
    action="store_true",
    help="Use unadjusted OHLC prices. Default output is auto-adjusted.",
  )
  args = parser.parse_args()

  try:
    import yfinance as yf
  except ModuleNotFoundError:
    print(
      "Missing dependency: yfinance. Install it with "
      "`python3 -m pip install -r scripts/requirements.txt`.",
      file=sys.stderr,
    )
    return 2

  output_dir = Path(args.output_dir)
  output_dir.mkdir(parents=True, exist_ok=True)

  had_error = False
  for symbol in args.symbols:
    normalized_symbol = symbol.upper().strip()
    if not normalized_symbol:
      continue

    try:
      payload = fetch_symbol(
        yf=yf,
        symbol=normalized_symbol,
        period=args.period,
        start=args.start,
        end=args.end,
        auto_adjust=not args.raw,
      )
      output_path = output_dir / f"{normalized_symbol}.json"
      output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
      )
      print(f"Wrote {output_path} ({len(payload['candles'])} candles)")
    except Exception as exc:
      had_error = True
      print(f"Failed to fetch {normalized_symbol}: {exc}", file=sys.stderr)

  return 1 if had_error else 0


def fetch_symbol(
  *,
  yf: Any,
  symbol: str,
  period: str,
  start: str | None,
  end: str | None,
  auto_adjust: bool,
) -> dict[str, Any]:
  ticker = yf.Ticker(symbol)
  history_kwargs: dict[str, Any] = {
    "interval": "1d",
    "auto_adjust": auto_adjust,
    "actions": False,
    "repair": False,
    "keepna": False,
    "rounding": False,
    "timeout": 20,
    "raise_errors": True,
  }

  if start:
    history_kwargs["start"] = start
    if end:
      history_kwargs["end"] = end
  else:
    history_kwargs["period"] = period

  frame = ticker.history(**history_kwargs)
  if frame.empty:
    raise RuntimeError("Yahoo Finance returned no rows")

  candles = []
  for index, row in frame.iterrows():
    date = index.strftime("%Y-%m-%d")
    try:
      open_price = float(row["Open"])
      high_price = float(row["High"])
      low_price = float(row["Low"])
      close_price = float(row["Close"])
    except (KeyError, TypeError, ValueError):
      continue

    prices = [open_price, high_price, low_price, close_price]
    if any(not is_valid_price(price) for price in prices):
      continue

    candles.append(
      {
        "date": date,
        "open": round(open_price, 4),
        "high": round(max(high_price, open_price, close_price), 4),
        "low": round(min(low_price, open_price, close_price), 4),
        "close": round(close_price, 4),
      }
    )

  if not candles:
    raise RuntimeError("No valid OHLC rows were returned")

  return {
    "provider": "yfinance",
    "source": "Yahoo Finance",
    "symbol": symbol,
    "interval": "1d",
    "period": None if start else period,
    "start": start,
    "end": end,
    "autoAdjust": auto_adjust,
    "fetchedAt": datetime.now(timezone.utc).isoformat(),
    "candles": candles,
  }


def is_valid_price(value: float) -> bool:
  return value > 0 and value != float("inf") and value != float("-inf")


if __name__ == "__main__":
  raise SystemExit(main())
