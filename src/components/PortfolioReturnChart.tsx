import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import type {
  PortfolioReturnPoint,
  PortfolioReturnResult,
} from '../domain/portfolioReturns'
import type { StrategySymbol } from '../domain/strategy'
import {
  formatCurrency,
  formatNumber,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent,
} from '../utils/formatters'
import { SummaryItem } from './SummaryItem'

interface PortfolioReturnChartProps {
  checkpointCount: number
  result: PortfolioReturnResult
  symbol: StrategySymbol
}

interface ReturnTooltip {
  point: PortfolioReturnPoint
  tone: 'negative' | 'neutral' | 'positive'
  x: number
  y: number
}

const CHART_HEIGHT = 360
const MOBILE_CHART_MAX_WIDTH = 520
const MOBILE_VISIBLE_BARS = 84
const MOBILE_RIGHT_OFFSET = 4
const TOOLTIP_WIDTH = 224
const TOOLTIP_HEIGHT = 144
const TOOLTIP_OFFSET = 12

export function PortfolioReturnChart({
  checkpointCount,
  result,
  symbol,
}: PortfolioReturnChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const assetSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const budgetSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const pointLookupRef = useRef<Map<string, PortfolioReturnPoint>>(new Map())
  const dataLengthRef = useRef(0)
  const [tooltip, setTooltip] = useState<ReturnTooltip | null>(null)
  const assetData = useMemo<LineData[]>(
    () =>
      result.points.map((point) => ({
        time: point.date,
        value: point.totalAsset,
      })),
    [result.points],
  )
  const budgetData = useMemo<LineData[]>(
    () =>
      result.points.map((point) => ({
        time: point.date,
        value: result.budget,
      })),
    [result.budget, result.points],
  )
  const latestPoint = result.latestPoint
  const statusMessage = getStatusMessage(result)
  const visibleTooltip = useMemo(() => {
    if (!tooltip || result.status !== 'ready') {
      return null
    }

    const point = result.points.find((item) => item.date === tooltip.point.date)

    return point
      ? {
          ...tooltip,
          point,
        }
      : null
  }, [result.points, result.status, tooltip])

  useEffect(() => {
    const container = containerRef.current

    if (!container || result.status !== 'ready') {
      return
    }

    const chart = createChart(container, {
      autoSize: false,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        textColor: '#64727f',
      },
      localization: {
        locale: 'ko-KR',
      },
      grid: {
        horzLines: { color: '#eef3f6' },
        vertLines: { color: '#eef3f6' },
      },
      rightPriceScale: {
        borderColor: '#dce4ea',
        scaleMargins: {
          bottom: 0.18,
          top: 0.12,
        },
        visible: true,
      },
      timeScale: {
        borderColor: '#dce4ea',
        secondsVisible: false,
        timeVisible: true,
      },
      width: container.clientWidth,
    })
    const assetSeries = chart.addSeries(LineSeries, {
      color: '#2563eb',
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      lineWidth: 3,
      priceFormat: {
        minMove: 0.01,
        precision: 2,
        type: 'price',
      },
      priceLineVisible: false,
    })
    const budgetSeries = chart.addSeries(LineSeries, {
      color: '#64727f',
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      priceFormat: {
        minMove: 0.01,
        precision: 2,
        type: 'price',
      },
      priceLineVisible: false,
    })
    const handleCrosshairMove = (param: MouseEventParams) => {
      setTooltip(createTooltip(param, pointLookupRef.current, container))
    }
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)

      if (width > 0) {
        chart.resize(width, CHART_HEIGHT)
        applyResponsiveVisibleRange(chart, dataLengthRef.current, width)
      }
    })

    chart.subscribeCrosshairMove(handleCrosshairMove)
    resizeObserver.observe(container)
    chartRef.current = chart
    assetSeriesRef.current = assetSeries
    budgetSeriesRef.current = budgetSeries
    applyResponsiveVisibleRange(chart, dataLengthRef.current, container.clientWidth)

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      assetSeriesRef.current = null
      budgetSeriesRef.current = null
    }
  }, [result.status])

  useEffect(() => {
    pointLookupRef.current = new Map(
      result.points.map((point) => [point.date, point]),
    )
    dataLengthRef.current = result.points.length
    assetSeriesRef.current?.setData(assetData)
    budgetSeriesRef.current?.setData(budgetData)

    if (chartRef.current && containerRef.current) {
      applyResponsiveVisibleRange(
        chartRef.current,
        result.points.length,
        containerRef.current.clientWidth,
      )
    }
  }, [assetData, budgetData, result.points])

  return (
    <section
      className="panel portfolio-return-panel"
      aria-labelledby="portfolio-return-title"
    >
      <div className="panel-heading">
        <h2 id="portfolio-return-title">수익률 그래프</h2>
        <div className="history-actions">
          <span className="panel-stat">{symbol}</span>
          <span className="panel-stat">
            첫 체결 {result.firstExecutionDate ?? '-'}
          </span>
          <span className="panel-stat">
            평가 {result.endDate ?? latestPoint?.date ?? '-'}
          </span>
          {checkpointCount > 0 ? (
            <span className="panel-stat">
              저장 기록 {formatNumber(checkpointCount)}개 기준
            </span>
          ) : null}
        </div>
      </div>

      {latestPoint ? (
        <div className="portfolio-return-summary" aria-label="수익률 요약">
          <SummaryItem label="시작 예산" value={formatCurrency(result.budget)} />
          <SummaryItem
            emphasis
            label="총자산"
            value={formatCurrency(latestPoint.totalAsset)}
          />
          <SummaryItem
            emphasis
            label="누적 수익률"
            value={formatSignedPercent(latestPoint.returnPercent)}
          />
          <SummaryItem label="보유수량" value={formatShares(latestPoint.shares)} />
        </div>
      ) : null}

      {result.status === 'ready' ? (
        <div className="portfolio-return-chart-shell">
          <div className="chart-legend" aria-label="수익률 그래프 범례">
            <strong className="chart-legend-title">일별 총자산</strong>
            <div className="chart-legend-indicators">
              <span>
                <b style={{ backgroundColor: '#2563eb' }} />
                총자산
              </span>
              <span>
                <b style={{ backgroundColor: '#64727f' }} />
                시작 예산
              </span>
            </div>
          </div>
          <div className="portfolio-return-stage">
            <div
              ref={containerRef}
              className="portfolio-return-chart"
              role="img"
              aria-label={`${symbol} 일별 총자산 수익률 그래프`}
            />
            {visibleTooltip ? (
              <div
                className={`portfolio-return-tooltip ${visibleTooltip.tone}`}
                style={{
                  left: `${visibleTooltip.x}px`,
                  top: `${visibleTooltip.y}px`,
                }}
              >
                <span>{visibleTooltip.point.date}</span>
                <strong>{formatCurrency(visibleTooltip.point.totalAsset)}</strong>
                <em>
                  {formatSignedPercent(visibleTooltip.point.returnPercent)} ·{' '}
                  {formatSignedCurrency(visibleTooltip.point.totalProfitLoss)}
                </em>
                <small>
                  잔금 {formatCurrency(visibleTooltip.point.cashBalance)} · 보유{' '}
                  {formatShares(visibleTooltip.point.shares)}
                </small>
                <small>
                  종가 {formatCurrency(visibleTooltip.point.close)} · 체결{' '}
                  {formatNumber(visibleTooltip.point.executedRecordCount)}건
                </small>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="empty-state">{statusMessage}</div>
      )}
    </section>
  )
}

function createTooltip(
  param: MouseEventParams,
  points: Map<string, PortfolioReturnPoint>,
  container: HTMLDivElement,
): ReturnTooltip | null {
  const date = normalizeChartTime(param.time)

  if (!date || !param.point) {
    return null
  }

  const point = points.get(date)

  if (!point) {
    return null
  }

  const x = clamp(
    param.point.x + TOOLTIP_OFFSET,
    TOOLTIP_OFFSET,
    Math.max(TOOLTIP_OFFSET, container.clientWidth - TOOLTIP_WIDTH - TOOLTIP_OFFSET),
  )
  const y = clamp(
    param.point.y + TOOLTIP_OFFSET,
    TOOLTIP_OFFSET,
    Math.max(
      TOOLTIP_OFFSET,
      container.clientHeight - TOOLTIP_HEIGHT - TOOLTIP_OFFSET,
    ),
  )

  return {
    point,
    tone:
      point.returnPercent > 0
        ? 'positive'
        : point.returnPercent < 0
          ? 'negative'
          : 'neutral',
    x,
    y,
  }
}

function normalizeChartTime(time?: Time): string | undefined {
  if (typeof time === 'string') {
    return time
  }

  if (typeof time === 'number') {
    return new Date(time * 1000).toISOString().slice(0, 10)
  }

  if (time && typeof time === 'object') {
    return `${time.year}-${String(time.month).padStart(2, '0')}-${String(
      time.day,
    ).padStart(2, '0')}`
  }

  return undefined
}

function applyResponsiveVisibleRange(
  chart: IChartApi,
  dataLength: number,
  width: number,
) {
  if (dataLength <= 0 || width <= 0) {
    return
  }

  if (width <= MOBILE_CHART_MAX_WIDTH && dataLength > MOBILE_VISIBLE_BARS) {
    chart.timeScale().setVisibleLogicalRange({
      from: dataLength - MOBILE_VISIBLE_BARS,
      to: dataLength - 1 + MOBILE_RIGHT_OFFSET,
    })
    return
  }

  chart.timeScale().fitContent()
}

function getStatusMessage(result: PortfolioReturnResult): string {
  switch (result.status) {
    case 'invalid-budget':
      return '시작 예산이 없어 수익률을 계산할 수 없습니다.'
    case 'invalid-range':
      return '선택한 산정일이 첫 체결일보다 빠릅니다.'
    case 'missing-history':
      return '체결 추정이 가능한 저장 주문 기록이 필요합니다. 주문 계산을 먼저 저장하세요.'
    case 'missing-prices':
      return 'yfinance 일봉 데이터를 불러오면 수익률 그래프가 표시됩니다.'
    case 'no-prices-in-range':
      return '첫 체결일 이후 표시할 가격 데이터가 없습니다.'
    case 'ready':
      return ''
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
