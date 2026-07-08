import { useMemo } from 'react'
import {
  calculateExecutionSummary,
  type ExecutionRecord,
} from '../domain/executions'
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatOptionalCurrency,
  formatShares,
  formatSignedCurrency,
} from '../utils/formatters'
import { HistoryPagination } from './HistoryPagination'
import { SummaryItem } from './SummaryItem'
import { TrashIcon } from './TrashIcon'

export const EXECUTION_PAGE_SIZE = 10

export function ExecutionLedgerSection({
  currentPage,
  historyCount,
  onApplyAll,
  onClear,
  onDelete,
  onPageChange,
  records,
}: {
  currentPage: number
  historyCount: number
  onApplyAll: () => void
  onClear: () => void
  onDelete: (recordId: string) => void
  onPageChange: (page: number) => void
  records: ExecutionRecord[]
}) {
  const summary = useMemo(() => calculateExecutionSummary(records), [records])
  const pageCount = Math.max(1, Math.ceil(records.length / EXECUTION_PAGE_SIZE))
  const boundedPage = Math.min(currentPage, pageCount)
  const pageStart = (boundedPage - 1) * EXECUTION_PAGE_SIZE
  const pageRows = records.slice(pageStart, pageStart + EXECUTION_PAGE_SIZE)

  return (
    <section className="panel execution-panel" aria-labelledby="execution-title">
      <div className="panel-heading">
        <h2 id="execution-title">체결 목록</h2>
        <div className="history-actions">
          <span className="panel-stat">
            최근 {records.length}건 · {boundedPage} / {pageCount}
          </span>
          <button
            type="button"
            className="secondary-action compact"
            disabled={historyCount === 0}
            onClick={onApplyAll}
          >
            전체 체결 반영
          </button>
          <button
            type="button"
            className="text-action"
            disabled={records.length === 0}
            onClick={onClear}
          >
            비우기
          </button>
        </div>
      </div>

      <div className="execution-summary-grid" aria-label="체결 요약">
        <SummaryItem label="매수 체결액" value={formatCurrency(summary.buyAmount)} />
        <SummaryItem label="매도 체결액" value={formatCurrency(summary.sellAmount)} />
        <SummaryItem label="수량" value={formatShares(summary.positionQuantity)} />
        <SummaryItem label="추정 평단가" value={formatOptionalCurrency(summary.averagePrice)} />
        <SummaryItem label="거래비용" value={formatCurrency(summary.feeAmount)} />
        <SummaryItem
          label="잔금 변화"
          value={formatSignedCurrency(summary.netCashFlow)}
        />
      </div>

      {records.length === 0 ? (
        <div className="empty-state">체결 기록 없음</div>
      ) : (
        <>
          <HistoryPagination
            ariaLabel="체결 목록 페이지"
            currentPage={boundedPage}
            pageCount={pageCount}
            pageEnd={Math.min(pageStart + EXECUTION_PAGE_SIZE, records.length)}
            pageStart={pageStart + 1}
            totalCount={records.length}
            onPageChange={onPageChange}
          />
          <div className="table-wrap execution-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">체결일자</th>
                  <th scope="col">종목</th>
                  <th scope="col">구분</th>
                  <th scope="col">가격</th>
                  <th scope="col">수량</th>
                  <th scope="col">체결금액</th>
                  <th scope="col">거래비용</th>
                  <th scope="col">잔금 변화</th>
                  <th scope="col">메모</th>
                  <th scope="col">삭제</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.date}</strong>
                      <small>{formatDateTime(record.createdAt)}</small>
                    </td>
                    <td>{record.symbol}</td>
                    <td>
                      <span className={`side-badge ${record.side}`}>
                        {record.side === 'buy' ? '매수' : '매도'}
                      </span>
                    </td>
                    <td>{formatCurrency(record.price)}</td>
                    <td>{formatNumber(record.quantity)}주</td>
                    <td>{formatCurrency(record.grossAmount)}</td>
                    <td>
                      {formatCurrency(record.feeAmount)}
                      <small>{formatNumber(record.feeRate * 100)}%</small>
                    </td>
                    <td>
                      <strong
                        className={
                          record.netCashFlow >= 0 ? 'amount-positive' : 'amount-negative'
                        }
                      >
                        {formatSignedCurrency(record.netCashFlow)}
                      </strong>
                    </td>
                    <td>{record.note || '-'}</td>
                    <td>
                      <button
                        type="button"
                        className="icon-action danger-action"
                        aria-label={`${record.symbol} ${record.date} 체결 기록 삭제`}
                        title="삭제"
                        onClick={() => onDelete(record.id)}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
