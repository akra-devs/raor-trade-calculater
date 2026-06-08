import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import {
  calculateBollingerBands,
  calculateMovingAverage,
  calculateRsi,
  type BollingerBandPoint,
  type DailyCandle,
  type IndicatorPoint,
} from '../domain/dailyPrices'
import type { StrategySymbol } from '../domain/strategy'

interface CandlestickChartProps {
  candles: DailyCandle[]
  intervalLabel: string
  onSelectDate: (date: string) => void
  selectedDate: string
  symbol: StrategySymbol
}

const CHART_HEIGHT = 420
const MOBILE_CHART_MAX_WIDTH = 520
const MOBILE_VISIBLE_BARS = 84
const MOBILE_RIGHT_OFFSET = 4
const HOVER_TOOLTIP_WIDTH = 178
const HOVER_TOOLTIP_HEIGHT = 82
const HOVER_TOOLTIP_OFFSET = 12
const movingAverageLines = [
  { period: 5, label: 'MA5', color: '#2563eb', width: 1 },
  { period: 20, label: 'MA20', color: '#d97706', width: 2 },
  { period: 60, label: 'MA60', color: '#059669', width: 1 },
] as const
const rsiIndicator = {
  period: 14,
  label: 'RSI14',
  color: '#7c3aed',
  width: 1,
} as const
const bollingerLines = [
  { key: 'upper', label: 'BB20 상단', color: '#ca8a04', width: 2 },
  { key: 'middle', label: 'BB20 중심', color: '#f59e0b', width: 1 },
  { key: 'lower', label: 'BB20 하단', color: '#ca8a04', width: 2 },
] as const

interface BollingerOverlayPath {
  clipHeight: number
  clipWidth: number
  clipX: number
  fillPath: string
  height: number
  lowerPath: string
  upperPath: string
  width: number
}

interface ChartHoverTooltip {
  change?: number
  changePercent?: number
  close: number
  date: string
  tone: 'negative' | 'neutral' | 'positive'
  x: number
  y: number
}

interface CandleLookupItem {
  candle: DailyCandle
  previousClose?: number
}

export function CandlestickChart({
  candles,
  intervalLabel,
  onSelectDate,
  selectedDate,
  symbol,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const movingAverageRefs = useRef<Array<ISeriesApi<'Line'>>>([])
  const bollingerRefs = useRef<Array<ISeriesApi<'Line'>>>([])
  const bollingerPointsRef = useRef<BollingerBandPoint[]>([])
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const onSelectDateRef = useRef(onSelectDate)
  const candleLookupRef = useRef<Map<string, CandleLookupItem>>(new Map())
  const chartDataLengthRef = useRef(0)
  const bollingerClipId = `bollinger-band-${useId().replace(/:/g, '')}`
  const [bollingerOverlay, setBollingerOverlay] =
    useState<BollingerOverlayPath | null>(null)
  const [hoverTooltip, setHoverTooltip] = useState<ChartHoverTooltip | null>(null)
  const chartData = useMemo<CandlestickData[]>(
    () =>
      candles.map((candle) => ({
        time: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    [candles],
  )
  const movingAverageData = useMemo(
    () =>
      movingAverageLines.map((average) => ({
        ...average,
        data: toLineData(calculateMovingAverage(candles, average.period)),
      })),
    [candles],
  )
  const bollingerPoints = useMemo(
    () => calculateBollingerBands(candles, 20, 2),
    [candles],
  )
  const bollingerBandData = useMemo(
    () =>
      bollingerLines.map((line) => ({
        ...line,
        data: toBollingerLineData(bollingerPoints, line.key),
      })),
    [bollingerPoints],
  )
  const rsiData = useMemo<LineData[]>(
    () => toLineData(calculateRsi(candles, rsiIndicator.period)),
    [candles],
  )
  const latestIndicators = useMemo(() => {
    const latestRsi = rsiData.at(-1)?.value
    const latestBollingerBand = bollingerPoints.at(-1)

    return {
      movingAverages: movingAverageData.map((average) => ({
        ...average,
        value: average.data.at(-1)?.value,
      })),
      bollingerBand: latestBollingerBand,
      rsi: latestRsi,
    }
  }, [bollingerPoints, movingAverageData, rsiData])

  useEffect(() => {
    onSelectDateRef.current = onSelectDate
  }, [onSelectDate])

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: CHART_HEIGHT,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#64727f',
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      },
      grid: {
        vertLines: { color: '#eef3f6' },
        horzLines: { color: '#eef3f6' },
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#dce4ea',
        scaleMargins: {
          top: 0.08,
          bottom: 0.16,
        },
      },
      leftPriceScale: {
        visible: true,
        borderColor: '#dce4ea',
        scaleMargins: {
          top: 0.08,
          bottom: 0.16,
        },
      },
      timeScale: {
        borderColor: '#dce4ea',
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        locale: 'ko-KR',
      },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#047857',
      downColor: '#b42318',
      wickUpColor: '#047857',
      wickDownColor: '#b42318',
      borderVisible: false,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    })
    const movingAverages = movingAverageLines.map((average) =>
      chart.addSeries(LineSeries, {
        color: average.color,
        lineWidth: average.width,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      }),
    )
    const bollingerBands = bollingerLines.map((line) =>
      chart.addSeries(LineSeries, {
        color: line.color,
        lineStyle: line.key === 'middle' ? LineStyle.Dotted : LineStyle.Dashed,
        lineWidth: line.width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      }),
    )
    const rsiSeries = chart.addSeries(
      LineSeries,
      {
        color: rsiIndicator.color,
        lineWidth: rsiIndicator.width,
        priceScaleId: 'left',
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        priceFormat: {
          type: 'price',
          precision: 0,
          minMove: 1,
        },
        autoscaleInfoProvider: () => ({
          priceRange: {
            minValue: 0,
            maxValue: 100,
          },
        }),
      },
    )
    const selectedDateMarkers = createSeriesMarkers(series, [])
    const handleClick = (param: MouseEventParams) => {
      const date = normalizeChartTime(param.time)

      if (date) {
        onSelectDateRef.current(date)
      }
    }
    const handleCrosshairMove = (param: MouseEventParams) => {
      setHoverTooltip(
        createHoverTooltip(param, candleLookupRef.current, container),
      )
    }
    let overlayFrame = 0
    let disposed = false
    const updateBollingerOverlay = () => {
      window.cancelAnimationFrame(overlayFrame)
      overlayFrame = window.requestAnimationFrame(() => {
        if (disposed) {
          return
        }

        setBollingerOverlay(
          createBollingerOverlayPath(
            chart,
            series,
            container,
            bollingerPointsRef.current,
          ),
        )
      })
    }

    rsiSeries.createPriceLine({
      price: 70,
      color: 'rgba(180, 35, 24, 0.5)',
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      axisLabelVisible: false,
    })
    rsiSeries.createPriceLine({
      price: 50,
      color: 'rgba(100, 114, 127, 0.42)',
      lineStyle: LineStyle.Dotted,
      lineWidth: 1,
      axisLabelVisible: false,
    })
    rsiSeries.createPriceLine({
      price: 30,
      color: 'rgba(4, 120, 87, 0.5)',
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      axisLabelVisible: false,
    })

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)

      if (width > 0) {
        chart.resize(width, CHART_HEIGHT)
        applyResponsiveVisibleRange(chart, chartDataLengthRef.current, width)
        updateBollingerOverlay()
      }
    })

    applyResponsiveVisibleRange(
      chart,
      chartDataLengthRef.current,
      container.clientWidth,
    )
    chart.subscribeClick(handleClick)
    chart.subscribeCrosshairMove(handleCrosshairMove)
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateBollingerOverlay)
    resizeObserver.observe(container)
    chartRef.current = chart
    seriesRef.current = series
    movingAverageRefs.current = movingAverages
    bollingerRefs.current = bollingerBands
    rsiSeriesRef.current = rsiSeries
    markerRef.current = selectedDateMarkers
    updateBollingerOverlay()

    return () => {
      disposed = true
      window.cancelAnimationFrame(overlayFrame)
      chart.unsubscribeClick(handleClick)
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateBollingerOverlay)
      selectedDateMarkers.detach()
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      movingAverageRefs.current = []
      bollingerRefs.current = []
      rsiSeriesRef.current = null
      markerRef.current = null
    }
  }, [])

  useEffect(() => {
    bollingerPointsRef.current = bollingerPoints
    candleLookupRef.current = createCandleLookup(candles)
    chartDataLengthRef.current = chartData.length
    seriesRef.current?.setData(chartData)
    movingAverageRefs.current.forEach((series, index) => {
      series.setData(movingAverageData[index]?.data ?? [])
    })
    bollingerRefs.current.forEach((series, index) => {
      series.setData(bollingerBandData[index]?.data ?? [])
    })
    rsiSeriesRef.current?.setData(rsiData)

    if (chartRef.current && containerRef.current) {
      applyResponsiveVisibleRange(
        chartRef.current,
        chartData.length,
        containerRef.current.clientWidth,
      )
    }

    const frame = window.requestAnimationFrame(() => {
      if (!chartRef.current || !seriesRef.current || !containerRef.current) {
        setBollingerOverlay(null)
        return
      }

      setBollingerOverlay(
        createBollingerOverlayPath(
          chartRef.current,
          seriesRef.current,
          containerRef.current,
          bollingerPoints,
        ),
      )
    })

    return () => window.cancelAnimationFrame(frame)
  }, [bollingerBandData, bollingerPoints, candles, chartData, movingAverageData, rsiData])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    const selectedCandle = candles.find((candle) => candle.date === selectedDate)

    if (!chart || !series || !selectedCandle) {
      markerRef.current?.setMarkers([])
      chart?.clearCrosshairPosition()
      return
    }

    markerRef.current?.setMarkers([
      {
        time: selectedCandle.date,
        position: 'aboveBar',
        color: '#0f766e',
        shape: 'circle',
        text: '매수일',
        size: 1.2,
      },
    ])
    moveCrosshairToCandle(chart, series, selectedCandle)
  }, [candles, selectedDate])

  return (
    <div className="chart-shell">
      <div className="chart-legend" aria-label={`${symbol} 차트 지표`}>
        <strong className="chart-legend-title">
          {symbol} {intervalLabel}
        </strong>
        <div className="chart-legend-indicators">
          {latestIndicators.movingAverages.map((average) => (
            <span key={average.period}>
              <b style={{ backgroundColor: average.color }} />
              {average.label} {formatIndicatorValue(average.value, '$')}
            </span>
          ))}
          <span>
            <b style={{ backgroundColor: rsiIndicator.color }} />
            {rsiIndicator.label} {formatIndicatorValue(latestIndicators.rsi)}
          </span>
          <span>
            <b style={{ backgroundColor: bollingerLines[0].color }} />
            BB20 {formatBollingerBandValue(latestIndicators.bollingerBand)}
          </span>
        </div>
      </div>
      <div className="chart-stage">
        <div
          ref={containerRef}
          className="candlestick-chart"
          role="img"
          aria-label={`${symbol} ${intervalLabel} 캔들 차트`}
        />
        {bollingerOverlay ? (
          <svg
            aria-hidden="true"
            className="bollinger-band-overlay"
            height={bollingerOverlay.height}
            viewBox={`0 0 ${bollingerOverlay.width} ${bollingerOverlay.height}`}
            width={bollingerOverlay.width}
          >
            <defs>
              <clipPath id={bollingerClipId}>
                <rect
                  height={bollingerOverlay.clipHeight}
                  width={bollingerOverlay.clipWidth}
                  x={bollingerOverlay.clipX}
                  y={0}
                />
              </clipPath>
            </defs>
            <g clipPath={`url(#${bollingerClipId})`}>
              <path className="bb-fill" d={bollingerOverlay.fillPath} />
              <path className="bb-edge" d={bollingerOverlay.upperPath} />
              <path className="bb-edge" d={bollingerOverlay.lowerPath} />
            </g>
          </svg>
        ) : null}
        {hoverTooltip ? (
          <div
            className={`chart-hover-tooltip ${hoverTooltip.tone}`}
            style={{
              left: `${hoverTooltip.x}px`,
              top: `${hoverTooltip.y}px`,
            }}
          >
            <span>{hoverTooltip.date}</span>
            <strong>종가 {formatChartCurrency(hoverTooltip.close)}</strong>
            <em>
              {typeof hoverTooltip.change === 'number' &&
              typeof hoverTooltip.changePercent === 'number'
                ? `전봉대비 ${formatSignedCurrency(hoverTooltip.change)} (${formatSignedPercent(hoverTooltip.changePercent)})`
                : '전봉대비 -'}
            </em>
          </div>
        ) : null}
        {candles.length === 0 ? (
          <div className="chart-empty">yfinance 데이터를 불러오면 차트가 표시됩니다.</div>
        ) : null}
      </div>
    </div>
  )
}

function toLineData(points: IndicatorPoint[]): LineData[] {
  return points.map((point) => ({
    time: point.date,
    value: point.value,
  }))
}

function toBollingerLineData(
  points: BollingerBandPoint[],
  key: keyof Pick<BollingerBandPoint, 'lower' | 'middle' | 'upper'>,
): LineData[] {
  return points.map((point) => ({
    time: point.date,
    value: point[key],
  }))
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

function createBollingerOverlayPath(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  container: HTMLDivElement,
  points: BollingerBandPoint[],
): BollingerOverlayPath | null {
  const width = container.clientWidth
  const height = container.clientHeight
  const plotLeft = chart.priceScale('left').width()
  const plotWidth = chart.timeScale().width()
  const plotHeight = Math.max(0, height - chart.timeScale().height())

  if (
    width <= 0 ||
    height <= 0 ||
    plotWidth <= 0 ||
    plotHeight <= 0 ||
    points.length < 2
  ) {
    return null
  }

  const upperPoints: SvgPoint[] = []
  const lowerPoints: SvgPoint[] = []

  for (const point of points) {
    const localX = chart.timeScale().timeToCoordinate(point.date)
    const upperY = series.priceToCoordinate(point.upper)
    const lowerY = series.priceToCoordinate(point.lower)

    if (localX === null || upperY === null || lowerY === null) {
      continue
    }

    if (localX < -80 || localX > plotWidth + 80) {
      continue
    }

    const x = plotLeft + localX

    upperPoints.push({ x: roundSvgCoordinate(x), y: roundSvgCoordinate(upperY) })
    lowerPoints.push({ x: roundSvgCoordinate(x), y: roundSvgCoordinate(lowerY) })
  }

  if (upperPoints.length < 2 || lowerPoints.length < 2) {
    return null
  }

  const upperPath = toSvgPath(upperPoints)
  const lowerPath = toSvgPath(lowerPoints)
  const fillPath = `${upperPath} ${[...lowerPoints]
    .reverse()
    .map((point) => `L ${point.x} ${point.y}`)
    .join(' ')} Z`

  return {
    clipHeight: plotHeight,
    clipWidth: plotWidth,
    clipX: plotLeft,
    fillPath,
    height,
    lowerPath,
    upperPath,
    width,
  }
}

interface SvgPoint {
  x: number
  y: number
}

function toSvgPath(points: SvgPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

function roundSvgCoordinate(value: number): number {
  return Math.round(value * 10) / 10
}

function createCandleLookup(candles: DailyCandle[]): Map<string, CandleLookupItem> {
  const lookup = new Map<string, CandleLookupItem>()

  candles.forEach((candle, index) => {
    lookup.set(candle.date, {
      candle,
      previousClose: candles[index - 1]?.close,
    })
  })

  return lookup
}

function createHoverTooltip(
  param: MouseEventParams,
  candles: Map<string, CandleLookupItem>,
  container: HTMLDivElement,
): ChartHoverTooltip | null {
  const date = normalizeChartTime(param.time)

  if (!date || !param.point) {
    return null
  }

  const item = candles.get(date)

  if (!item) {
    return null
  }

  const previousClose = item.previousClose
  const change =
    typeof previousClose === 'number' && previousClose > 0
      ? item.candle.close - previousClose
    : undefined
  const changePercent =
    typeof change === 'number' && typeof previousClose === 'number'
      ? (change / previousClose) * 100
      : undefined
  const tone =
    typeof change === 'number' && change > 0
      ? 'positive'
      : typeof change === 'number' && change < 0
        ? 'negative'
        : 'neutral'

  return {
    change,
    changePercent,
    close: item.candle.close,
    date,
    tone,
    x: clamp(
      param.point.x + HOVER_TOOLTIP_OFFSET,
      HOVER_TOOLTIP_OFFSET,
      Math.max(
        HOVER_TOOLTIP_OFFSET,
        container.clientWidth - HOVER_TOOLTIP_WIDTH - HOVER_TOOLTIP_OFFSET,
      ),
    ),
    y: clamp(
      param.point.y + HOVER_TOOLTIP_OFFSET,
      HOVER_TOOLTIP_OFFSET,
      Math.max(
        HOVER_TOOLTIP_OFFSET,
        container.clientHeight - HOVER_TOOLTIP_HEIGHT - HOVER_TOOLTIP_OFFSET,
      ),
    ),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function normalizeChartTime(time: MouseEventParams['time']): string | undefined {
  if (typeof time === 'string') {
    return time
  }

  return undefined
}

function moveCrosshairToCandle(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  candle: DailyCandle,
) {
  const priceCoordinate = series.priceToCoordinate(candle.close)
  const timeCoordinate = chart.timeScale().timeToCoordinate(candle.date)

  if (priceCoordinate === null || timeCoordinate === null) {
    chart.clearCrosshairPosition()
    return
  }

  try {
    chart.setCrosshairPosition(candle.close, candle.date, series)
  } catch {
    chart.clearCrosshairPosition()
  }
}

function formatBollingerBandValue(value?: BollingerBandPoint): string {
  if (!value) {
    return '-'
  }

  return `${formatIndicatorValue(value.upper, '$')} / ${formatIndicatorValue(value.lower, '$')}`
}

function formatChartCurrency(value: number): string {
  return `$${value.toFixed(2)}`
}

function formatSignedCurrency(value: number): string {
  if (Math.abs(value) < 0.005) {
    return '$0.00'
  }

  const sign = value > 0 ? '+' : '-'
  return `${sign}$${Math.abs(value).toFixed(2)}`
}

function formatSignedPercent(value: number): string {
  if (Math.abs(value) < 0.005) {
    return '0.00%'
  }

  const sign = value > 0 ? '+' : '-'
  return `${sign}${Math.abs(value).toFixed(2)}%`
}

function formatIndicatorValue(value?: number, prefix = ''): string {
  if (typeof value !== 'number') {
    return '-'
  }

  return `${prefix}${value.toFixed(2)}`
}
