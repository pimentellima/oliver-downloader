import { cn } from '@renderer/lib/utils'

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}
