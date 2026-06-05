#!/usr/bin/env python3
"""Fetch daily OHLC data from Yahoo Finance through yfinance.

The React app is browser-only, so it cannot import Python packages directly.
This script writes static JSON files under public/market-data for the app to load.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_OUTPUT_DIR = Path("public/market-data")
MARKET_TIMEZONE = ZoneInfo("America/New_York")
MARKET_CLOSE_READY_TIME = time(16, 15)
RECENT_PATCH_DAYS = 10


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
  parser.add_argument(
    "--include-current-day",
    action="store_true",
    help="Keep the current US trading day if yfinance returns it. Default excludes it until 16:15 New York time.",
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
  try:
    import pandas_market_calendars as mcal
  except ModuleNotFoundError:
    print(
      "Missing dependency: pandas_market_calendars. Install it with "
      "`python3 -m pip install -r scripts/requirements.txt`.",
      file=sys.stderr,
    )
    return 2

  market_calendar = mcal.get_calendar("NYSE")

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
        market_calendar=market_calendar,
        symbol=normalized_symbol,
        period=args.period,
        start=args.start,
        end=args.end,
        auto_adjust=not args.raw,
        include_current_day=args.include_current_day,
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
  market_calendar: Any,
  symbol: str,
  period: str,
  start: str | None,
  end: str | None,
  auto_adjust: bool,
  include_current_day: bool,
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
  schedule = get_market_schedule(
    market_calendar=market_calendar,
    frame=frame,
    start=start,
    end=end,
  )
  frame = merge_recent_history_patch(
    ticker=ticker,
    frame=frame,
    base_kwargs=history_kwargs,
    schedule=schedule,
  )
  if frame.empty:
    raise RuntimeError("Yahoo Finance returned no rows")

  candles = []
  skipped_closed_days: set[str] = set()
  missing_trading_days: set[str] = set()
  for index, row in frame.iterrows():
    date = index.strftime("%Y-%m-%d")
    if not include_current_day and is_unfinished_current_market_day(date):
      continue

    if not is_market_trading_day(schedule, date):
      skipped_closed_days.add(date)
      continue

    if not is_valid_history_row(row):
      missing_trading_days.add(date)
      continue

    open_price = float(row["Open"])
    high_price = float(row["High"])
    low_price = float(row["Low"])
    close_price = float(row["Close"])

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

  expected_trading_days = list_market_trading_days(schedule)
  candle_dates = {candle["date"] for candle in candles}
  for date in expected_trading_days:
    if date in candle_dates:
      continue

    if not include_current_day and is_unfinished_current_market_day(date):
      continue

    missing_trading_days.add(date)

  return {
    "provider": "yfinance",
    "source": "Yahoo Finance",
    "symbol": symbol,
    "interval": "1d",
    "period": None if start else period,
    "start": start,
    "end": end,
    "autoAdjust": auto_adjust,
    "includeCurrentDay": include_current_day,
    "currentDayPolicy": (
      "include" if include_current_day else "exclude-before-ny-16:15"
    ),
    "calendar": "NYSE",
    "fetchedAt": datetime.now(timezone.utc).isoformat(),
    "missingTradingDays": sorted(missing_trading_days),
    "skippedClosedDays": sorted(skipped_closed_days),
    "candles": candles,
  }


def get_market_schedule(
  *,
  market_calendar: Any,
  frame: Any,
  start: str | None,
  end: str | None,
) -> Any:
  if start:
    schedule_start = start
  elif not frame.empty:
    schedule_start = frame.index.min().strftime("%Y-%m-%d")
  else:
    schedule_start = (
      datetime.now(MARKET_TIMEZONE).date() - timedelta(days=RECENT_PATCH_DAYS)
    ).isoformat()

  if end:
    schedule_end = (
      datetime.strptime(end, "%Y-%m-%d").date() - timedelta(days=1)
    ).isoformat()
  else:
    schedule_end = datetime.now(MARKET_TIMEZONE).date().isoformat()

  return market_calendar.schedule(
    start_date=schedule_start,
    end_date=schedule_end,
  )


def list_market_trading_days(schedule: Any) -> list[str]:
  return [index.strftime("%Y-%m-%d") for index in schedule.index]


def is_market_trading_day(schedule: Any, date: str) -> bool:
  return date in set(list_market_trading_days(schedule))


def merge_recent_history_patch(
  *,
  ticker: Any,
  frame: Any,
  base_kwargs: dict[str, Any],
  schedule: Any,
) -> Any:
  """Patch stale broad Yahoo responses with focused recent queries.

  Yahoo occasionally returns the latest trading day with NaN OHLC values for
  broad period queries, while a single-day start/end query already has the
  final close. Keep the broad history for depth, but let focused recent
  responses overwrite the latest rows.
  """
  candidate_dates = set(list_market_trading_days(schedule)[-RECENT_PATCH_DAYS:])

  for index, row in frame.tail(RECENT_PATCH_DAYS * 2).iterrows():
    date = index.strftime("%Y-%m-%d")
    if is_market_trading_day(schedule, date) and not is_valid_history_row(row):
      candidate_dates.add(date)

  if not candidate_dates:
    return frame

  merged = frame.copy()
  for candle_date in sorted(candidate_dates):
    start_date = datetime.strptime(candle_date, "%Y-%m-%d").date()
    exact_kwargs = dict(base_kwargs)

    exact_kwargs.pop("period", None)
    exact_kwargs["start"] = candle_date
    exact_kwargs["end"] = (start_date + timedelta(days=2)).isoformat()
    exact_kwargs["keepna"] = True

    try:
      exact_frame = ticker.history(**exact_kwargs)
    except Exception:
      continue

    for index, row in exact_frame.iterrows():
      if not is_valid_history_row(row):
        continue

      for column, value in row.items():
        merged.loc[index, column] = value

  return merged.sort_index()


def is_valid_history_row(row: Any) -> bool:
  try:
    prices = [float(row[column]) for column in ["Open", "High", "Low", "Close"]]
  except (KeyError, TypeError, ValueError):
    return False

  return all(is_valid_price(price) for price in prices)


def is_valid_price(value: float) -> bool:
  return math.isfinite(value) and value > 0


def is_unfinished_current_market_day(candle_date: str) -> bool:
  try:
    parsed_date = datetime.strptime(candle_date, "%Y-%m-%d").date()
  except ValueError:
    return False

  now = datetime.now(MARKET_TIMEZONE)
  return parsed_date == now.date() and now.time() < MARKET_CLOSE_READY_TIME


if __name__ == "__main__":
  raise SystemExit(main())
