import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return 'Duração desconhecida'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

export function formatBytes(bytes: number | null): string {
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    analyzing: 'Analisando',
    downloading: 'Baixando',
    converting: 'Convertendo',
    completed: 'Concluído',
    failed: 'Falhou',
    cancelled: 'Cancelado'
  }
  return labels[status] ?? status
}
