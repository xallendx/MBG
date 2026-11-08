/**
 * Logger terstruktur sederhana.
 *
 * Sebelumnya error di route API hanya `console.error(...)` atau — lebih buruk —
 * ditelan oleh `catch {}` tanpa jejak sama sekali (ada 61 kejadian). Akibatnya
 * kegagalan di produksi tidak bisa ditelusuri: tidak ada konteks route, user,
 * maupun request id.
 *
 * Format satu baris JSON supaya mudah dicari di Vercel Logs / Datadog / Loki:
 *   {"level":"error","ts":"…","ctx":"POST /api/tasks","msg":"…","userId":"…"}
 *
 * Kalau nanti butuh error tracking (Sentry dsb), cukup ganti implementasi
 * `write()` — semua pemanggil tidak perlu diubah.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

type Meta = Record<string, unknown>

function write(level: Level, ctx: string, msg: string, meta?: Meta) {
  const entry = {
    level,
    ts: new Date().toISOString(),
    ctx,
    msg,
    ...(meta || {}),
  }

  const line = JSON.stringify(entry)

  // LEVEL_LOG bisa dipakai untuk meredam log debug di produksi.
  const minLevel = (process.env.LEVEL_LOG as Level) || 'info'
  const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
  if (order[level] < order[minLevel]) return

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function logDebug(ctx: string, msg: string, meta?: Meta) {
  write('debug', ctx, msg, meta)
}

export function logInfo(ctx: string, msg: string, meta?: Meta) {
  write('info', ctx, msg, meta)
}

export function logWarn(ctx: string, msg: string, meta?: Meta) {
  write('warn', ctx, msg, meta)
}

/**
 * Catat error apa pun beserta konteksnya.
 * Error yang tidak dikenal tetap dicatat (termasuk stack) — tidak pernah ditelan.
 */
export function logError(ctx: string, error: unknown, meta?: Meta) {
  const err = error instanceof Error ? error : new Error(String(error))
  write('error', ctx, err.message, {
    ...meta,
    errorName: err.name,
    stack: err.stack?.split('\n').slice(0, 6).join(' | '),
  })
}
