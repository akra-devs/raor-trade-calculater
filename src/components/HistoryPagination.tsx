export function HistoryPagination({
  ariaLabel = '저장된 주문 기록 페이지',
  currentPage,
  onPageChange,
  pageCount,
  pageEnd,
  pageStart,
  totalCount,
}: {
  ariaLabel?: string
  currentPage: number
  onPageChange: (page: number) => void
  pageCount: number
  pageEnd: number
  pageStart: number
  totalCount: number
}) {
  return (
    <div className="history-pagination" aria-label={ariaLabel}>
      <span>
        {pageStart}-{pageEnd} / {totalCount}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="text-action"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        >
          이전
        </button>
        <span>
          {currentPage} / {pageCount}
        </span>
        <button
          type="button"
          className="text-action"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
        >
          다음
        </button>
      </div>
    </div>
  )
}
