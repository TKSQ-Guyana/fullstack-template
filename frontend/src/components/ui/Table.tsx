// The generic table: columns as data, presentational only — sorting and
// paging belong to the screen that owns the rows.
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface Column<Row> {
  key: string
  header: string
  render?: (row: Row) => ReactNode
  className?: string
}

export function Table<Row>({
  columns,
  data,
  rowKey,
  emptyMessage = 'Nothing here yet.',
  onRowClick,
}: {
  columns: Column<Row>[]
  data: Row[]
  rowKey: (row: Row) => string
  emptyMessage?: string
  onRowClick?: (row: Row) => void
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-rule bg-surface shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-xs tracking-wide text-ink-400 uppercase">
            {columns.map((c) => (
              <th key={c.key} className={cn('px-4 py-3 font-semibold', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-ink-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  'border-b border-rule last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-brand-50',
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3', c.className)}>
                    {c.render
                      ? c.render(row)
                      : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
