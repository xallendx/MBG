import { db } from '@/lib/db'
import { logInfo } from '@/lib/logger'

/** Riwayat tidak dihapus kecuali operator mengaktifkan retensi. */
/** Nilai fallback untuk menghitung cutoff, bukan kebijakan penghapusan default. */
export const DEFAULT_TASKLOG_RETENTION_DAYS = 730

export function taskLogCutoff(days = DEFAULT_TASKLOG_RETENTION_DAYS, now = new Date()): Date {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_TASKLOG_RETENTION_DAYS
  return new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000)
}

/**
 * Destructive retention is opt-in. Keep at least the newest log per task so a
 * completed one-shot task cannot become ready merely because history aged out.
 * userId is an optional scope for maintenance or isolated tests.
 */
export async function pruneTaskLogs(days?: number, userId?: string): Promise<number> {
  const raw = days ?? (process.env.TASKLOG_RETENTION_DAYS ? Number(process.env.TASKLOG_RETENTION_DAYS) : 0)
  if (!Number.isFinite(raw) || raw < 1) return 0
  const cutoff = taskLogCutoff(raw)
  const scope = userId ?? null
  const count = await db.$executeRaw`
    DELETE FROM "TaskLog" AS old
    WHERE old."completedAt" < ${cutoff}
      AND (${scope}::text IS NULL OR EXISTS (
        SELECT 1 FROM "Task" task WHERE task.id = old."taskId" AND task."userId" = ${scope}
      ))
      AND EXISTS (
        SELECT 1 FROM "TaskLog" newer
        WHERE newer."taskId" = old."taskId"
          AND (newer."completedAt" > old."completedAt"
            OR (newer."completedAt" = old."completedAt" AND newer.id > old.id))
      )
  `
  if (count > 0) logInfo('retention:task-log', 'log penyelesaian lama dipangkas', { deleted: count, cutoff: cutoff.toISOString() })
  return count
}
