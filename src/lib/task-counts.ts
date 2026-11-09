/**
 * Satu sumber kebenaran untuk "tugas mana yang tampil di tab ini".
 *
 * Sebelumnya daftar dan angka tab dihitung terpisah di `page.tsx`:
 * daftar memakai `getActiveTasks(pool)` sedangkan angka "Semua" memakai
 * `pool` mentah kalau sedang difilter per proyek. Akibatnya tugas sekali yang
 * sudah selesai (arsip) hilang dari daftar tapi masih dihitung, sehingga di
 * dalam proyek muncul "Semua (3)" padahal kartunya cuma 2.
 *
 * Sekarang angka dan daftar memanggil fungsi yang sama, jadi keduanya tidak
 * bisa berbeda lagi.
 */

export type TaskTab = 'all' | 'siap' | 'cooldown' | 'selesai'

export interface CountableTask {
  status: string
  scheduleType: string
}

/**
 * Tugas "Sekali" / "Mulai tanggal" yang sudah selesai tidak akan pernah siap
 * lagi, jadi ia keluar dari daftar aktif dan pindah ke arsip (tab Selesai).
 * Tugas berulang tidak pernah masuk sini: selesai dikerjakan ia menunggu jeda.
 */
export function isArchivedTask(task: CountableTask): boolean {
  return task.status === 'selesai' && (task.scheduleType === 'sekali' || task.scheduleType === 'tanggal_spesifik')
}

export function activeOnly<T extends CountableTask>(pool: T[]): T[] {
  return pool.filter(t => !isArchivedTask(t))
}

/**
 * Isi satu tab. Tab "Selesai" sengaja memakai seluruh pool supaya riwayat
 * (termasuk arsip tugas sekali) tetap bisa dilihat dan dibatalkan.
 */
export function tasksForTab<T extends CountableTask>(pool: T[], tab: TaskTab): T[] {
  const base = tab === 'selesai' ? pool : activeOnly(pool)
  return tab === 'all' ? base : base.filter(t => t.status === tab)
}

/** Angka pada tombol tab — selalu sama dengan jumlah baris/kartu yang tampil. */
export function countForTab<T extends CountableTask>(
  pool: T[],
  tab: TaskTab,
  matches: (task: T) => boolean = () => true,
): number {
  return tasksForTab(pool, tab).filter(matches).length
}

/**
 * Ringkasan "Selesai" harus memakai hitungan yang sama dengan tab Selesai,
 * yaitu semua tugas berstatus selesai termasuk arsip. Dulu ringkasan memakai
 * tugas aktif saja, sehingga tertulis "Selesai 0" padahal tab Selesai berisi
 * belasan tugas sekali yang sudah dikerjakan.
 */
export function countDone<T extends CountableTask>(pool: T[]): number {
  return pool.filter(t => t.status === 'selesai').length
}
