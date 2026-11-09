/**
 * Idempotensi POST /api/tasks tanpa perubahan skema database.
 *
 * Browser mengirim UUID per tugas yang sedang ditulis. Server mengubahnya
 * menjadi id Task deterministik yang terikat pada user; unique constraint
 * PRIMARY KEY yang sudah ada menjadi pengaman balapan/retry. Tidak ada tabel
 * atau kolom baru, jadi tidak ada migration SQL yang perlu dijalankan di Neon.
 */
import { createHash } from 'node:crypto'
import { canonicalJson } from './task-form'

export interface TaskCreatePayload {
  name: string
  description: string | null
  link: string | null
  notes: string | null
  scheduleType: string
  scheduleConfig: Record<string, unknown>
  projectId: string | null
  pinned: boolean
  priority: string
}

export function taskRequestId(userId: string, clientRequestId: string): string {
  return 'req_' + createHash('sha256').update(JSON.stringify([userId, clientRequestId])).digest('hex').slice(0, 40)
}

function storedConfig(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

/** Kunci yang sama hanya boleh mengulang isi yang sama; jangan diam-diam mengembalikan tugas lain. */
export function matchesCreatedTask(task: Omit<TaskCreatePayload, 'scheduleConfig'> & { scheduleConfig: string }, input: TaskCreatePayload): boolean {
  return task.name === input.name
    && task.description === input.description
    && task.link === input.link
    && task.notes === input.notes
    && task.scheduleType === input.scheduleType
    && canonicalJson(storedConfig(task.scheduleConfig)) === canonicalJson(input.scheduleConfig)
    && task.projectId === input.projectId
    && task.pinned === input.pinned
    && task.priority === input.priority
}
