/**
 * Tugas mana yang layak diperiksa sweep pengingat.
 *
 * KENAPA PERLU
 * ------------
 * Sweep dulu hanya mengambil tugas yang **sudah punya log penyelesaian**.
 * Akibatnya tugas terjadwal yang baru dibuat tidak pernah dikabari pada siklus
 * pertamanya — padahal justru itu saat pengguna menutup aplikasi dan menunggu
 * pengingat:
 *
 *   - "Klaim faucet setiap hari 09:00" dibuat jam 08:00 → status Menunggu,
 *     tapi tidak ada pengingat 08:55 maupun 09:00 karena belum pernah selesai.
 *   - "Mulai tanggal 15 Desember" → tidak pernah dikabari sama sekali sebelum
 *     dikerjakan, jadi tanggal yang dipasang sendiri tidak ada gunanya.
 *
 * Sekarang tugas tanpa log ikut diperiksa **selama masih menunggu**. Tugas baru
 * yang sudah siap sejak awal tetap dilewati: tidak ada gunanya mengirim "Task
 * siap!" untuk tugas yang baru saja dibuat, dan itu bisa memborbardir pengguna
 * yang membuat puluhan tugas sekaligus.
 */

export interface NotifyCandidate {
  scheduleType: string
  hasLogs: boolean
}

/**
 * `msUntilReady` = sisa waktu menuju siap (negatif/nol berarti sudah siap).
 * `nextReadyExists` false untuk tugas sekali yang tidak punya jadwal berikutnya.
 */
export function isNotificationCandidate(
  task: NotifyCandidate,
  nextReadyExists: boolean,
  msUntilReady: number,
): boolean {
  // Tugas "Sekali" selalu siap sejak dibuat — tidak ada yang perlu diingatkan.
  if (task.scheduleType === 'sekali') return false
  if (!nextReadyExists) return false
  // Baru dibuat dan sudah siap: biarkan pengguna melihatnya sendiri di daftar.
  if (!task.hasLogs && msUntilReady <= 0) return false
  return true
}
