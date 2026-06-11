import { cn } from '@renderer/lib/utils'

export function Progress({ value, className }: { value: number | null; className?: string }): JSX.Element {
  const width = value == null ? 14 : Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className={cn('h-full rounded-full bg-primary transition-all', value == null && 'animate-pulse')}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
