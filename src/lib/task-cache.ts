/**
 * Segarkan tugas yang dibaca dari cache localStorage.
 *
 * KENAPA PERLU
 * ------------
 * Cache dipakai supaya daftar langsung tampil sebelum server menjawab. Dulu
 * hanya `cooldownMs` yang dihitung ulang dari `nextReadyAt`, sementara `status`
 * dan `cooldownRemaining` dipakai apa adanya dari saat cache ditulis.
 *
 * Akibatnya tugas yang cooldown-nya sudah lewat tetap terlihat "Menunggu 5j 0m"
 * sampai server menjawab — dan kalau jaringan gagal, selamanya. Karena kartu
 * tugas menunggu tombol utamanya "Lihat detail", pengguna tidak bisa membuka
 * link tugas yang sebenarnya sudah siap dikerjakan.
 *
 * Arah perbaikannya sengaja satu arah saja: cache tidak boleh menyuruh pengguna
 * menunggu tugas yang waktunya sudah lewat. Tugas yang menurut cache sudah siap
 * tidak diturunkan jadi menunggu — itu wewenang server.
 */

export interface CachedTaskLike {
  status: string
  nextReadyAt: string | null
  cooldownRemaining: string
  cooldownMs?: number
}

export function refreshCachedTask<T extends CachedTaskLike>(task: T, nowMs: number = Date.now()): T {
  if (task.status !== 'cooldown') {
    return { ...task, cooldownMs: 0, cooldownRemaining: '' }
  }

  const readyAtMs = task.nextReadyAt ? new Date(task.nextReadyAt).getTime() : NaN
  if (!Number.isFinite(readyAtMs)) {
    // Tidak ada waktu siap yang sah → tidak ada dasar untuk menyuruh menunggu.
    return { ...task, status: 'siap', cooldownRemaining: '', cooldownMs: 0 }
  }

  const remaining = readyAtMs - nowMs
  if (remaining <= 0) {
    return { ...task, status: 'siap', cooldownRemaining: '', cooldownMs: 0 }
  }

  const hours = Math.floor(remaining / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  const text = hours > 0 ? `${hours}j ${mins}m` : mins > 0 ? `${mins}m` : 'kurang dari 1m'
  return { ...task, cooldownRemaining: text, cooldownMs: remaining }
}

export function refreshCachedTasks<T extends CachedTaskLike>(tasks: T[], nowMs: number = Date.now()): T[] {
  return tasks.map(t => refreshCachedTask(t, nowMs))
}
