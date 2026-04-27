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
 * Get a Date representing "now" in the user's timezone context.
 * Uses `toLocaleString` to get the current date/time parts in the target timezone,
 * then constructs a Date that when used with `getHours()`/`getMinutes()` etc.
 * returns the user's local time values.
 */
function getUserNow(timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  const now = new Date()
  // Get the user's date/time as a formatted string
  const userStr = now.toLocaleString('en-US', { timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  // Parse it back into a Date that preserves the user's clock values
  // Format: "MM/DD/YYYY, HH:MM:SS"
  const parts = userStr.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/)
  if (parts) {
    const userDate = new Date(now)
    userDate.setFullYear(parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]))
    userDate.setHours(parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6]), 0)
    return userDate
  }
  return now
}

/**
 * Convert a user-timezone-local Date to UTC for storage/comparison.
 * Takes a Date that represents a time in the user's timezone (e.g., 09:00 WIB)
 * and returns a Date with the correct UTC time (e.g., 02:00 UTC).
 */
function userLocalToUTC(userLocalDate: Date, timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  // Get the user's date/time string
  const userStr = userLocalDate.toLocaleString('en-US', { timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const utcStr = userLocalDate.toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  // Parse both
  const parseParts = (s: string) => s.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/)
  const uParts = parseParts(userStr)
  const utcParts = parseParts(utcStr)
  if (!uParts || !utcParts) return userLocalDate
  // Calculate the offset: user time - UTC time (in ms)
  const userMs = (parseInt(uParts[3]) * 365 + parseInt(uParts[1]) * 30 + parseInt(uParts[2])) * 86400000 +
    parseInt(uParts[4]) * 3600000 + parseInt(uParts[5]) * 60000 + parseInt(uParts[6]) * 1000
  const utcMs = (parseInt(utcParts[3]) * 365 + parseInt(utcParts[1]) * 30 + parseInt(utcParts[2])) * 86400000 +
    parseInt(utcParts[4]) * 3600000 + parseInt(utcParts[5]) * 60000 + parseInt(utcParts[6]) * 1000
  const offset = userMs - utcMs
  // We want: given userLocalDate (whose getHours() etc. return user-time values),
  // produce a UTC Date. UTC = userLocalDate - offset
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
 * Get the user's date (YYYY-MM-DD) for a given UTC Date.
 */
function getUserDateStr(utcDate: Date, timezone: string): string {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  return utcDate.toLocaleDateString('en-CA', { timeZone: iana }) // en-CA gives YYYY-MM-DD format
}

/**
 * Create a Date representing "user's midnight today" in UTC.
 * E.g., for WIB user: midnight WIB = 17:00 UTC previous day
 */
function getUserMidnightToday(utcNow: Date, timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  // Get the date string in user's timezone
  const dateStr = utcNow.toLocaleDateString('en-CA', { timeZone: iana }) // YYYY-MM-DD
  // Create a Date for that date at 00:00 in the user's timezone
  // Use the offset method
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
      // Parse dates as user's midnight (timezone-aware)
      const parsed = dates.map(d => {
        // "YYYY-MM-DD" → midnight in user's timezone
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
      // Use user's current day of week
      const currentDay = getUserDayOfWeek(now, tz)
      let daysUntil = targetDay - currentDay
      if (daysUntil < 0) daysUntil += 7
      if (daysUntil === 0 && lastLog) {
        const hoursSince = (now.getTime() - lastLog.getTime()) / 3600000
        if (hoursSince < cdHours) daysUntil = 7
      }
      // Calculate next occurrence at user's midnight
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
      // Use user's current date for "today"
      const userMidnight = getUserMidnightToday(now, tz)
      const sorted = times.map(t => {
        const [h, m] = t.split(':').map(Number)
        // Create a Date for this time in the user's timezone
        const tempDate = new Date(userMidnight)
        tempDate.setHours(h, m, 0, 0) // setHours on a UTC date = wrong!
        // Instead, we need to set the user's hours on userMidnight
        // userMidnight is already midnight in user's TZ (in UTC)
        // So adding h hours + m minutes gives the correct UTC time
        const userTime = new Date(userMidnight.getTime() + h * 3600000 + m * 60000)
        return userTime
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
