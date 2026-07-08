import { TRADE_COST_RATE, type ProfitLossResult } from '../domain/profitLoss'
import type { Mode } from '../domain/strategy'
import type { NextTurnPreview, OrderSnapshot } from '../types/app'
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatSignedCurrency,
  formatSignedPercent,
} from '../utils/formatters'
import { TrashIcon } from './TrashIcon'

export function HistoryItem({
  defaultGainPercent,
  onApplyNextTurn,
  onDelete,
  onRestore,
  onShowOrders,
  preview,
  profitLoss,
  snapshot,
}: {
  defaultGainPercent: string
  onApplyNextTurn: (snapshot: OrderSnapshot, preview: NextTurnPreview) => void
  onDelete: (snapshotId: string) => void
  onRestore: (snapshot: OrderSnapshot) => void
  onShowOrders: (snapshot: OrderSnapshot) => void
  preview: NextTurnPreview
  profitLoss?: ProfitLossResult
  snapshot: OrderSnapshot
}) {
  return (
    <article className="history-item">
      <div>
        <strong>
          {snapshot.input.symbol} · {modeLabel(snapshot.result.summary.effectiveMode)}
        </strong>
        <span>{formatDateTime(snapshot.createdAt)}</span>
      </div>
      <div className="history-meta">
        <span>{snapshot.result.orders.length}건</span>
        <span>목표 {snapshot.input.gainPercent ?? defaultGainPercent}%</span>
        <span>T {snapshot.input.turn}</span>
        <span>{snapshot.input.splitCount}분할</span>
      </div>
      <HistoryProfitLoss profitLoss={profitLoss} />
      <HistoryNextTurnPreview
        onApply={() => onApplyNextTurn(snapshot, preview)}
        preview={preview}
        snapshot={snapshot}
      />
      <div className="history-item-actions">
        <button
          type="button"
          className="secondary-action compact restore-action"
          onClick={() => onRestore(snapshot)}
        >
          입력값 불러오기
        </button>
        <button
          type="button"
          className="secondary-action compact detail-action"
          onClick={() => onShowOrders(snapshot)}
        >
          주문 상세
        </button>
        <button
          type="button"
          className="icon-action danger-action delete-action"
          aria-label={`${snapshot.input.symbol} ${formatDateTime(snapshot.createdAt)} 주문 기록 삭제`}
          title="삭제"
          onClick={() => onDelete(snapshot.id)}
        >
          <TrashIcon />
        </button>
      </div>
    </article>
  )
}

function HistoryProfitLoss({
  profitLoss,
}: {
  profitLoss?: ProfitLossResult
}) {
  if (!profitLoss) {
    return (
      <div className="history-pnl-card muted">
        <span>누적손익</span>
        <strong>-</strong>
        <small>예산과 기준가를 확인하세요</small>
      </div>
    )
  }

  const tone =
    profitLoss.totalProfitLoss > 0
      ? 'positive'
      : profitLoss.totalProfitLoss < 0
        ? 'negative'
        : 'neutral'

  return (
    <div className={`history-pnl-card ${tone}`}>
      <span>누적손익</span>
      <strong>{formatSignedCurrency(profitLoss.totalProfitLoss)}</strong>
      <small>예산대비 {formatSignedPercent(profitLoss.budgetReturnPercent)}</small>
      {typeof profitLoss.buyAmountReturnPercent === 'number' ? (
        <small>매수금액대비 {formatSignedPercent(profitLoss.buyAmountReturnPercent)}</small>
      ) : null}
      <small>
        {profitLoss.markDate ?? '기준가'} · {formatNumber(TRADE_COST_RATE * 100)}%
        비용 {formatCurrency(profitLoss.totalFees)} · 체결추정{' '}
        {profitLoss.executedOrderCount}건
      </small>
    </div>
  )
}

function HistoryNextTurnPreview({
  onApply,
  preview,
  snapshot,
}: {
  onApply: () => void
  preview: NextTurnPreview
  snapshot: OrderSnapshot
}) {
  if (!preview.calculation || !preview.executionCandle) {
    return (
      <div className="history-next-turn muted">
        <span>다음 T</span>
        <strong>-</strong>
        <small>{preview.message}</small>
      </div>
    )
  }

  const executedLabels = preview.calculation.executedOrderTags.map(
    (tag) =>
      snapshot.result.orders.find((order) => order.tag === tag)?.label ?? tag,
  )
  const executionSummary =
    executedLabels.length > 0 ? executedLabels.join(', ') : '체결 없음'

  return (
    <div className="history-next-turn">
      <div>
        <span>
          {preview.referenceDate ?? '-'} → {preview.executionCandle.date}
        </span>
        <strong>
          T {formatNumber(preview.calculation.previousTurn)} →{' '}
          {formatNumber(preview.calculation.nextTurn)} · 보유{' '}
          {formatNumber(preview.calculation.previousShares)} →{' '}
          {formatNumber(preview.calculation.nextShares)}주
        </strong>
        <small>
          종가 {formatCurrency(preview.executionCandle.close)}
          {preview.calculation.usedHighForLimitSell
            ? ` · 지정가 고가 ${formatCurrency(preview.executionCandle.high)} 추정`
            : ''}
          {preview.isReferenceDateInferred ? ' · 기준일 추정' : ''}
        </small>
        <small>
          잔금 {formatCurrency(preview.calculation.nextCashBalance)} · 추정 평단가{' '}
          {formatCurrency(preview.calculation.nextAveragePrice)}
        </small>
        <small>{executionSummary}</small>
      </div>
      <button type="button" className="secondary-action compact" onClick={onApply}>
        체결 추정 반영
      </button>
    </div>
  )
}

function modeLabel(mode: Mode): string {
  return mode === 'normal' ? '일반' : '리버스'
}
