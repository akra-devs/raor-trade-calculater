import { useMemo } from 'react'
import { calculateExecutionAnalysis } from '../domain/executionAnalysis'
import type { ExecutionRecord } from '../domain/executions'
import type { StrategySymbol } from '../domain/strategy'
import {
  formatCurrency,
  formatNumber,
  formatOptionalCurrency,
  formatShares,
} from '../utils/formatters'
import { SummaryItem } from './SummaryItem'

export function ExecutionAnalysisSection({
  endDate,
  onEndDateChange,
  onResetPeriod,
  onStartDateChange,
  records,
  startDate,
  symbol,
}: {
  endDate: string
  onEndDateChange: (date: string) => void
  onResetPeriod: () => void
  onStartDateChange: (date: string) => void
  records: ExecutionRecord[]
  startDate: string
  symbol: StrategySymbol
}) {
  const analysis = useMemo(
    () =>
      calculateExecutionAnalysis({
        endDate,
        records,
        startDate,
        symbol,
      }),
    [endDate, records, startDate, symbol],
  )
  const hasSymbolRecords = analysis.symbolRecordCount > 0
  const hasPeriodFilter = Boolean(startDate || endDate)
  const periodLabel = formatAnalysisPeriodLabel(analysis, hasPeriodFilter)
  const metricValue = (value: string) => analysis.isInvalidPeriod ? '-' : value

  return (
    <section
      className="panel execution-analysis-panel"
      aria-labelledby="execution-analysis-title"
    >
      <div className="panel-heading">
        <h2 id="execution-analysis-title">체결 분석</h2>
        <div className="history-actions">
          <span className="panel-stat">{symbol}</span>
          <span className="panel-stat">{periodLabel}</span>
          <span className="panel-stat">
            분석 {analysis.matchedRecordCount}건
          </span>
        </div>
      </div>

      <div className="analysis-controls" aria-label="체결 분석 기간">
        <label className="field" htmlFor="execution-analysis-start">
          <span>시작일</span>
          <input
            id="execution-analysis-start"
            type="date"
            value={startDate}
            onChange={(event) => onStartDateChange(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="execution-analysis-end">
          <span>종료일</span>
          <input
            id="execution-analysis-end"
            type="date"
            value={endDate}
            onChange={(event) => onEndDateChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary-action compact"
          disabled={!hasPeriodFilter}
          onClick={onResetPeriod}
        >
          전체 기간
        </button>
      </div>

      {analysis.isInvalidPeriod ? (
        <div className="warning-list analysis-warning" role="status">
          <div>기간을 확인하세요. 시작일은 종료일보다 늦을 수 없습니다.</div>
        </div>
      ) : null}

      {!hasSymbolRecords ? (
        <div className="empty-state">분석할 체결 기록 없음</div>
      ) : (
        <>
          <div className="analysis-primary-grid" aria-label="체결 분석 핵심 지표">
            <SummaryItem
              emphasis
              label="매도수량"
              value={metricValue(formatShares(analysis.sellQuantity))}
            />
            <SummaryItem
              emphasis
              label="매도평단"
              value={metricValue(formatOptionalCurrency(analysis.sellAveragePrice))}
            />
            <SummaryItem
              emphasis
              label="현재 수량"
              value={metricValue(formatShares(analysis.positionQuantity))}
            />
            <SummaryItem
              emphasis
              label="현재 평단"
              value={metricValue(formatOptionalCurrency(analysis.averagePrice))}
            />
          </div>

          <div className="analysis-secondary-grid" aria-label="체결 분석 보조 지표">
            <SummaryItem
              label="매도 체결액"
              value={metricValue(formatCurrency(analysis.sellAmount))}
            />
            <SummaryItem
              label="매도 거래비용"
              value={metricValue(formatCurrency(analysis.sellFeeAmount))}
            />
            <SummaryItem
              label="매도 건수"
              value={metricValue(`${formatNumber(analysis.sellRecordCount)}건`)}
            />
            <SummaryItem
              label="분석 체결"
              value={metricValue(`${formatNumber(analysis.matchedRecordCount)}건`)}
            />
          </div>
        </>
      )}
    </section>
  )
}

function formatAnalysisPeriodLabel(
  analysis: ReturnType<typeof calculateExecutionAnalysis>,
  hasPeriodFilter: boolean,
): string {
  if (analysis.isInvalidPeriod) {
    return '기간 오류'
  }

  if (!hasPeriodFilter) {
    return '전체 기간'
  }

  const start = analysis.effectiveStartDate ?? '처음'
  const end = analysis.effectiveEndDate ?? '최신'

  return start === end ? start : `${start} ~ ${end}`
}
