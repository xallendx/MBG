// Shared schedule logic — used by tasks/route.ts, notify/run/route.ts, and telegram/webhook/route.ts
// Prevents code duplication and ensures consistent error handling

export interface ScheduleTask {
  scheduleType: string
  scheduleConfig: string
  logs: { completedAt: Date }[]
}

export function getNextReadyAt(task: ScheduleTask): Date | null {
  let config: Record<string, unknown>
  try {
    config = JSON.parse(task.scheduleConfig)
  } catch {
    config = {}
  }
  const now = new Date()
  const lastLog = task.logs.length > 0
    ? new Date(task.logs.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0].completedAt)
    : null

  switch (task.scheduleType) {
    case 'sekali':
      // Sekali = jalan sekali saja, setelah selesai status = selesai
      return null
    case 'tanggal_spesifik': {
      // Tanggal spesifik = sekali juga, tapi punya tanggal target
      // Sebelum tanggal: status = cooldown (menunggu tanggal)
      // Sesudah tanggal: status = siap
      // Setelah dikerjakan: status = selesai (tidak bisa diulang)
      const dates: string[] = (config.dates as string[]) || []
      if (dates.length === 0) return now
      // Ambil tanggal target terdekat yang belum lewat
      const parsed = dates.map(d => new Date(d + 'T00:00:00')).filter(d => !isNaN(d.getTime()))
      const futureDates = parsed.filter(d => d >= now).sort((a, b) => a.getTime() - b.getTime())
      if (futureDates.length === 0) {
        // Semua tanggal sudah lewat → siap sekarang (belum pernah dikerjakan) atau selesai (sudah pernah)
        return task.logs.length > 0 ? null : now
      }
      // Belum ada yang complete → tunggu tanggal pertama
      if (task.logs.length === 0) return futureDates[0]
      // Sudah ada yang complete → selesai
      return null
    }
    case 'harian': case 'kustom': {
      const cdHours = (config.cooldownHours as number) || 24
      if (!lastLog) return now
      return new Date(lastLog.getTime() + cdHours * 3600000)
    }
    case 'mingguan': {
      const targetDay = (config.dayOfWeek as number) ?? 0 // 0=Minggu ... 6=Sabtu
      const cdHours = (config.cooldownHours as number) || 24
      const current = new Date(now)
      const currentDay = current.getDay()
      let daysUntil = targetDay - currentDay
      if (daysUntil < 0) daysUntil += 7
      if (daysUntil === 0 && lastLog) {
        const lastDate = new Date(lastLog)
        const hoursSince = (current.getTime() - lastDate.getTime()) / 3600000
        if (hoursSince < cdHours) daysUntil = 7
      }
      const next = new Date(current)
      next.setDate(next.getDate() + daysUntil)
      next.setHours(0, 0, 0, 0)
      if (!lastLog) return daysUntil === 0 ? now : next
      const readyAfterCd = new Date(lastLog.getTime() + cdHours * 3600000)
      if (readyAfterCd > next) next.setDate(next.getDate() + 7)
      return next > now ? next : now
    }
    case 'jam_tertentu': {
      const times: string[] = (config.times as string[]) || []
      if (times.length === 0) return now
      const setNow = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const sorted = times.map(t => {
        const [h, m] = t.split(':').map(Number)
        const d = new Date(setNow)
        d.setHours(h, m, 0, 0)
        return d
      }).sort((a, b) => a.getTime() - b.getTime())
      for (const t of sorted) { if (t > now) return t }
      const tomorrow = new Date(sorted[0])
      tomorrow.setDate(tomorrow.getDate() + 1)
      return tomorrow
    }
    default:
      return null
  }
}

export function computeStatus(task: ScheduleTask): 'siap' | 'cooldown' | 'selesai' {
  const nextReady = getNextReadyAt(task)
  if (!nextReady) {
    return task.logs.length > 0 ? 'selesai' : 'siap'
  }
  if (nextReady <= new Date()) return 'siap'
  return 'cooldown'
}

/** Check if a task type allows reset (undo all logs) */
export function canReset(scheduleType: string): boolean {
  // sekali dan tanggal_spesifik tidak bisa di-reset — task final
  return scheduleType !== 'sekali' && scheduleType !== 'tanggal_spesifik'
}
