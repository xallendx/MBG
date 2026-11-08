// Shared schedule logic — used by tasks/route.ts, notify/run/route.ts, and telegram/webhook/route.ts
// Prevents code duplication and ensures consistent error handling

export interface ScheduleTask {
  scheduleType: string
  scheduleConfig: string
  logs: { completedAt: Date }[]
  createdAt?: Date | string
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
 * Get the UTC offset in milliseconds for a given timezone at a given UTC moment.
 * Uses Intl.DateTimeFormat for robust, DST-aware offset calculation.
 * Works correctly regardless of server timezone.
 */
function getUtcOffsetMs(date: Date, ianaTz: string): number {
  // Gunakan tanggal lengkap, bukan hanya hari-dalam-bulan: selisih hari
  // 31 Desember → 1 Januari tidak boleh terbaca sebagai -30 hari.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ianaTz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (key: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === key)?.value)
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Convert a user-timezone-local Date to UTC for storage/comparison.
 * Takes a Date that represents a time in the user's timezone (e.g., 09:00 WIB)
 * and returns a Date with the correct UTC time (e.g., 02:00 UTC).
 *
 * BUG FIX: Rewrote to include date components in offset calculation,
 * preventing day-wrapping issues when timezone offset causes date change.
 */
function userLocalToUTC(userLocalDate: Date, timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  const offsetMs = getUtcOffsetMs(userLocalDate, iana)
  // The userLocalDate is interpreted as being in the user's timezone.
  // Subtract the offset to get UTC.
  return new Date(userLocalDate.getTime() - offsetMs)
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
 *
 * BUG FIX: Rewrote to use full offset calculation (includes date component),
 * preventing incorrect results on non-UTC servers or with large timezone offsets.
 */
function getUserMidnightToday(utcNow: Date, timezone: string): Date {
  const iana = TZ_MAP[timezone] || 'Asia/Jakarta'
  const dateStr = utcNow.toLocaleDateString('en-CA', { timeZone: iana }) // YYYY-MM-DD
  const parts = dateStr.split('-')
  // BUG FIX: pakai Date.UTC, bukan `new Date(y, m, d)`.
  // `new Date(y, m, d)` mengikuti timezone proses server, sehingga hasilnya
  // berbeda antara server UTC (Vercel) dan server WIB/WITA (self-host).
  // Dengan Date.UTC + koreksi offset, hasilnya sama di mana pun dijalankan.
  const userMidnightUtcNaive = new Date(Date.UTC(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
    0, 0, 0, 0
  ))
  return userLocalToUTC(userMidnightUtcNaive, timezone)
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
  const createdAt = task.createdAt ? safeDate(task.createdAt) : null

  switch (task.scheduleType) {
    case 'sekali':
      return null

    case 'tanggal_spesifik': {
      // Tanggal adalah waktu mulai siap, bukan deadline. Tugas hanya sekali.
      if (lastLog) return null
      const dates = Array.isArray(config.dates) ? config.dates : []
      const parsed = dates.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).map(d => {
        const [year, month, day] = d.split('-').map(Number)
        const dt = new Date(Date.UTC(year, month - 1, day))
        if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
        return userLocalToUTC(dt, tz)
      }).filter((d): d is Date => d !== null).sort((x, y) => x.getTime() - y.getTime())
      // Beberapa tanggal lama: siap sejak tanggal pertama, tidak lompat ke tanggal berikutnya.
      return parsed[0] ?? now
    }

    case 'harian': case 'kustom': {
      // Pure millisecond offset — timezone-independent ✅
      const cdHours = (config.cooldownHours as number) || 24
      if (!lastLog) return now
      const ready = new Date(lastLog.getTime() + cdHours * 3600000)
      return isNaN(ready.getTime()) ? now : ready
    }

    case 'mingguan': {
      const targetDay = Number.isInteger(config.dayOfWeek) && Number(config.dayOfWeek) >= 0 && Number(config.dayOfWeek) <= 6 ? Number(config.dayOfWeek) : 0
      const day = getUserDayOfWeek(now, tz)
      const midnight = getUserMidnightToday(now, tz)
      const nextOffset = (targetDay - day + 7) % 7
      const mostRecentOffset = (day - targetDay + 7) % 7
      const mostRecent = new Date(midnight.getTime() - mostRecentOffset * 86400000)
      const next = new Date(midnight.getTime() + (nextOffset || 7) * 86400000)
      // Tanpa log, hari yang sudah lewat dalam minggu ini tetap bisa dikerjakan.
      // Jika hari target masih di depan dan belum ada log, tunggu hari itu.
      if (!lastLog && targetDay > day && (!createdAt || createdAt > mostRecent)) return new Date(midnight.getTime() + nextOffset * 86400000)
      if (!lastLog || lastLog < mostRecent) return now
      // Hormati cooldown lama jika lebih panjang dari sisa minggu.
      const cdHours = Number(config.cooldownHours) > 0 ? Number(config.cooldownHours) : 24
      const cooldownEnd = new Date(lastLog.getTime() + cdHours * 3600000)
      if (cooldownEnd > next) next.setTime(next.getTime() + 7 * 86400000)
      return next
    }

    case 'jam_tertentu': {
      const times = Array.isArray(config.times) ? config.times : []
      const minutes = [...new Set(times.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(t => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)).map(t => {
        const [h, m] = t.split(':').map(Number)
        return h * 60 + m
      }))].sort((a, b) => a - b)
      if (!minutes.length) return now
      const midnight = getUserMidnightToday(now, tz)
      const today = minutes.map(m => new Date(midnight.getTime() + m * 60000))
      const passed = today.filter(t => t <= now)
      const next = today.find(t => t > now) ?? new Date(today[0].getTime() + 86400000)
      const latestSlot = passed.length ? passed[passed.length - 1] : new Date(today[today.length - 1].getTime() - 86400000)
      if (!lastLog) return passed.length || (createdAt && createdAt <= latestSlot) ? now : today[0]
      // Tetap siap setelah jam berlalu sampai dikerjakan; sekali per interval.
      return lastLog < latestSlot ? now : next
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
