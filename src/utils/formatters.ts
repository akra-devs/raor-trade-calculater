const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('ko-KR', {
  maximumFractionDigits: 2,
})

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value)
}

export function formatOptionalCurrency(value?: number): string {
  return typeof value === 'number' ? formatCurrency(value) : '-'
}

export function formatSignedCurrency(value: number): string {
  if (value === 0) {
    return formatCurrency(0)
  }

  const sign = value > 0 ? '+' : '-'
  return `${sign}${formatCurrency(Math.abs(value))}`
}

export function formatShares(value: number): string {
  return `${formatNumber(Math.max(0, value))}주`
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatSignedPercent(value: number): string {
  if (value === 0) {
    return '0%'
  }

  const sign = value > 0 ? '+' : '-'
  return `${sign}${formatNumber(Math.abs(value))}%`
}

export function formatChange(value?: number): string {
  if (typeof value !== 'number') {
    return '-'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value)}%`
}

export function formatDateTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}
