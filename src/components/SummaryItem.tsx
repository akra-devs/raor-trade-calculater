export function SummaryItem({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean
  label: string
  value: string
}) {
  return (
    <div className={emphasis ? 'summary-item emphasis' : 'summary-item'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
