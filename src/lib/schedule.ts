// Shared schedule logic — used by tasks/route.ts, notify/run/route.ts, and telegram/webhook/route.ts
// Prevents code duplication and ensures consistent error handling

export interface ScheduleTask {
  scheduleType: string
  scheduleConfig: string
  logs: { completedAt: Date }[]
}

// Map user-friendly timezone names to IANA timezone identifiers
const TZ_MAP: Record<string, string> = {
  'WIB': 'Asia/Jakarta',   // UTC+7
  'WITA': 'Asia/Makassar', // UTC+8
  'WIT': 'Asia/Jayapura',  // UTC+9
}

function safeDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d
  }
  return null
}

/**
 * Convert a user-timezone-local Date to UTC for storage/comparison.
 * Takes a Date that represents a time in the user's timezone (e.g., 09:00 WIB)
 * and returns a Date with the correct UTC time (e.g., 02:00 UTC).
 */
function userLocalToUTC(userLocalDate: Date, timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  const userStr = userLocalDate.toLocaleString('en-US', { timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const utcStr = userLocalDate.toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const parseParts = (s: string) => s.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/)
  const uParts = parseParts(userStr)
  const utcParts = parseParts(utcStr)
  if (!uParts || !utcParts) return userLocalDate
  // The hour/minute/second difference is the UTC offset (year/month/day cancel out)
  const offset = (parseInt(uParts[4]) - parseInt(utcParts[4])) * 3600000 +
    (parseInt(uParts[5]) - parseInt(utcParts[5])) * 60000 +
    (parseInt(uParts[6]) - parseInt(utcParts[6])) * 1000
  return new Date(userLocalDate.getTime() - offset)
}

/**
 * Get the user's day of week (0=Sun...6=Sat) for a given UTC Date.
 */
function getUserDayOfWeek(utcDate: Date, timezone: string): number {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  const userStr = utcDate.toLocaleString('en-US', { timeZone: iana, weekday: 'short' })
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days.indexOf(userStr)
}

/**
 * Create a Date representing "user's midnight today" in UTC.
 * E.g., for WIB user: midnight WIB = 17:00 UTC previous day
 */
function getUserMidnightToday(utcNow: Date, timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  const dateStr = utcNow.toLocaleDateString('en-CA', { timeZone: iana }) // YYYY-MM-DD
  const tempDate = new Date()
  tempDate.setFullYear(parseInt(dateStr.substring(0, 4)), parseInt(dateStr.substring(5, 7)) - 1, parseInt(dateStr.substring(8, 10)))
  tempDate.setHours(0, 0, 0, 0)
  return userLocalToUTC(tempDate, timezone)
}

export function getNextReadyAt(task: ScheduleTask, timezone?: string): Date | null {
  const tz = timezone || 'WIB'
  let config: Record<string, unknown>
  try {
    config = JSON.parse(task.scheduleConfig)
  } catch {
    config = {}
  }
  const now = new Date() // UTC
  const validLogs = task.logs
    .map(l => safeDate(l.completedAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())
  const lastLog = validLogs.length > 0 ? validLogs[0] : null

  switch (task.scheduleType) {
    case 'sekali':
      return null

    case 'tanggal_spesifik': {
      const dates: string[] = (config.dates as string[]) || []
      if (dates.length === 0) return now
      const parsed = dates.map(d => {
        const parts = d.split('-')
        if (parts.length !== 3) return null
        const tempDate = new Date()
        tempDate.setFullYear(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
        tempDate.setHours(0, 0, 0, 0)
        return userLocalToUTC(tempDate, tz)
      }).filter((d): d is Date => d !== null && !isNaN(d.getTime()))
      const futureDates = parsed.filter(d => d >= now).sort((a, b) => a.getTime() - b.getTime())
      if (futureDates.length === 0) {
        return task.logs.length > 0 ? null : now
      }
      if (task.logs.length === 0) return futureDates[0]
      return null
    }

    case 'harian': case 'kustom': {
      // Pure millisecond offset — timezone-independent ✅
      const cdHours = (config.cooldownHours as number) || 24
      if (!lastLog) return now
      const ready = new Date(lastLog.getTime() + cdHours * 3600000)
      return isNaN(ready.getTime()) ? now : ready
    }

    case 'mingguan': {
      const targetDay = (config.dayOfWeek as number) ?? 0 // 0=Minggu ... 6=Sabtu
      const cdHours = (config.cooldownHours as number) || 24
      const currentDay = getUserDayOfWeek(now, tz)
      let daysUntil = targetDay - currentDay
      if (daysUntil < 0) daysUntil += 7
      if (daysUntil === 0 && lastLog) {
        const hoursSince = (now.getTime() - lastLog.getTime()) / 3600000
        if (hoursSince < cdHours) daysUntil = 7
      }
      const userMidnight = getUserMidnightToday(now, tz)
      const nextMidnight = new Date(userMidnight.getTime() + daysUntil * 86400000)
      if (!lastLog) return daysUntil === 0 ? now : nextMidnight
      const readyAfterCd = new Date(lastLog.getTime() + cdHours * 3600000)
      if (!isNaN(readyAfterCd.getTime()) && readyAfterCd > nextMidnight) {
        nextMidnight.setTime(nextMidnight.getTime() + 7 * 86400000)
      }
      return nextMidnight > now ? nextMidnight : now
    }

    case 'jam_tertentu': {
      const times: string[] = (config.times as string[]) || []
      if (times.length === 0) return now
      const userMidnight = getUserMidnightToday(now, tz)
      const sorted = times.map(t => {
        const [h, m] = t.split(':').map(Number)
        // userMidnight is midnight in user's TZ (expressed as UTC).
        // Adding h hours + m minutes gives the correct UTC time.
        return new Date(userMidnight.getTime() + h * 3600000 + m * 60000)
      }).sort((a, b) => a.getTime() - b.getTime())
      for (const t of sorted) { if (t > now) return t }
      // All times today have passed → first time tomorrow
      const tomorrow = sorted.length > 0 ? new Date(sorted[0].getTime() + 86400000) : new Date(now)
      return isNaN(tomorrow.getTime()) ? now : tomorrow
    }

    default:
      return null
  }
}

export function computeStatus(task: ScheduleTask, timezone?: string): 'siap' | 'cooldown' | 'selesai' {
  const nextReady = getNextReadyAt(task, timezone)
  if (!nextReady) {
    return task.logs.length > 0 ? 'selesai' : 'siap'
  }
  if (nextReady <= new Date()) return 'siap'
  return 'cooldown'
}

/** Check if a task type allows reset (undo all logs) */
export function canReset(scheduleType: string): boolean {
  return scheduleType !== 'sekali' && scheduleType !== 'tanggal_spesifik'
}
