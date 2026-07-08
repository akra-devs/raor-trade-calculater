import { useEffect } from 'react'
import type { GenerateOrdersResult, Mode } from '../domain/strategy'
import {
  formatCurrency,
  formatNumber,
  formatOptionalCurrency,
} from '../utils/formatters'
import { SummaryItem } from './SummaryItem'

export function ResultModal({
  eyebrow,
  onClose,
  result,
  title,
}: {
  eyebrow: string
  onClose: () => void
  result: GenerateOrdersResult
  title: string
}) {
  useModalEscape(onClose)

  return (
    <div
      className="result-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        aria-labelledby="result-modal-title"
        aria-modal="true"
        className="result-modal"
        role="dialog"
      >
        <div className="result-modal-head">
          <div>
            <span>{eyebrow}</span>
            <h2 id="result-modal-title">{title}</h2>
          </div>
          <div className="result-modal-actions">
            <span className="panel-stat">{result.orders.length}건</span>
            <button type="button" className="secondary-action compact" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        <div className="result-modal-body">
          <Summary result={result} />
          <Warnings result={result} />
          <OrdersTable result={result} />
        </div>
      </section>
    </div>
  )
}

export function NoticeModal({
  details,
  message,
  onClose,
  title,
}: {
  details?: string[]
  message: string
  onClose: () => void
  title: string
}) {
  useModalEscape(onClose)

  return (
    <div
      className="result-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        aria-labelledby="notice-modal-title"
        aria-modal="true"
        className="result-modal notice-modal"
        role="dialog"
      >
        <div className="result-modal-head notice-modal-head">
          <div>
            <span>저장된 주문 기록</span>
            <h2 id="notice-modal-title">{title}</h2>
          </div>
          <button type="button" className="secondary-action compact" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="notice-modal-body">
          <p>{message}</p>
          {details && details.length > 0 ? (
            <div className="notice-detail-list">
              {details.map((detail) => (
                <span key={detail}>{detail}</span>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function useModalEscape(onClose: () => void) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])
}

function Summary({ result }: { result: GenerateOrdersResult }) {
  const { summary } = result
  const buyBudget =
    summary.effectiveMode === 'reverse'
      ? summary.reverseBuyBudget
      : summary.oneBuyAmount
  const buyBudgetLabel =
    summary.effectiveMode === 'reverse' ? '리버스 매수금' : '1회매수금'
  const referenceLabel =
    summary.effectiveMode === 'reverse' ? '5일 평균' : '전일 종가'

  return (
    <div className="summary-grid" aria-label="계산 요약">
      <SummaryItem label="모드" value={modeLabel(summary.effectiveMode)} />
      {summary.effectiveMode === 'normal' ? (
        <SummaryItem label="별%" value={`${formatNumber(summary.starPercent)}%`} />
      ) : null}
      <SummaryItem
        label={buyBudgetLabel}
        value={
          typeof buyBudget === 'number' ? formatCurrency(buyBudget) : '-'
        }
      />
      <SummaryItem label="목표가" value={formatOptionalCurrency(summary.targetPrice)} />
      <SummaryItem
        label="별 매도가"
        value={formatOptionalCurrency(summary.starSellPrice)}
      />
      <SummaryItem
        label="별 매수가"
        value={formatOptionalCurrency(summary.starBuyPrice)}
      />
      <SummaryItem label={referenceLabel} value={formatOptionalCurrency(summary.referenceClose)} />
      <SummaryItem label="원금 기준" value={formatCurrency(summary.capitalBase)} />
    </div>
  )
}

function Warnings({ result }: { result: GenerateOrdersResult }) {
  if (result.warnings.length === 0) {
    return null
  }

  return (
    <div className="warning-list" role="status" aria-label="경고">
      {result.warnings.map((warning, index) => (
        <div key={`${warning.code}-${warning.tag ?? index}`}>{warning.message}</div>
      ))}
    </div>
  )
}

function OrdersTable({ result }: { result: GenerateOrdersResult }) {
  if (result.orders.length === 0) {
    return <div className="empty-state">생성 주문 없음</div>
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">구분</th>
            <th scope="col">주문</th>
            <th scope="col">유형</th>
            <th scope="col">수량</th>
            <th scope="col">주문 기준</th>
            <th scope="col">배정금</th>
            <th scope="col">예상 주문금액</th>
          </tr>
        </thead>
        <tbody>
          {result.orders.map((order) => (
            <tr key={order.id}>
              <td>
                <span className={`side-badge ${order.side}`}>
                  {order.side === 'buy' ? '매수' : '매도'}
                </span>
              </td>
              <td>
                <strong>{order.label}</strong>
                {order.note ? <small>{order.note}</small> : null}
              </td>
              <td>{order.type}</td>
              <td>{formatNumber(order.quantity)}주</td>
              <OrderPriceCell order={order} />
              <td>{order.side === 'buy' ? formatOptionalCurrency(order.amount) : '-'}</td>
              <td>{formatOptionalCurrency(calculateOrderNotional(order))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OrderPriceCell({ order }: { order: GenerateOrdersResult['orders'][number] }) {
  const condition = getOrderCondition(order)

  return (
    <td>
      <div className={`order-condition ${condition.direction}`}>
        <span aria-hidden="true">{condition.marker}</span>
        <strong>{condition.label}</strong>
      </div>
    </td>
  )
}

function getOrderCondition(order: GenerateOrdersResult['orders'][number]) {
  if (order.type === 'MOC' || typeof order.price !== 'number') {
    return {
      direction: 'neutral',
      label: '장마감 시장가',
      marker: 'MOC',
    }
  }

  if (order.type === 'LOC' && order.side === 'buy') {
    return {
      direction: 'down',
      label: `종가 ≤ ${formatCurrency(order.price)}`,
      marker: '↓',
    }
  }

  if (order.type === 'LOC') {
    return {
      direction: 'up',
      label: `종가 ≥ ${formatCurrency(order.price)}`,
      marker: '↑',
    }
  }

  return {
    direction: 'neutral',
    label: `지정가 ${formatCurrency(order.price)}`,
    marker: 'LIMIT',
  }
}

function calculateOrderNotional(order: GenerateOrdersResult['orders'][number]) {
  if (typeof order.price !== 'number') {
    return undefined
  }

  return order.quantity * order.price
}

function modeLabel(mode: Mode): string {
  return mode === 'normal' ? '일반' : '리버스'
}
