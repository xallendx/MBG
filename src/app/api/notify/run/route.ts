import { NextResponse } from 'next/server'
import { requireCurrentUser } from '@/lib/auth'
import { sweepUserNotifications } from '@/lib/notify-sweep'
import { handleApiError } from '@/lib/api'

/**
 * POST /api/notify/run
 *
 * Dipanggil browser secara berkala sebagai *catch-up*: memastikan notifikasi
 * untuk user yang sedang login tetap terkirim meskipun cron belum berjalan
 * (mis. saat self-host tanpa cron) atau baru saja terlewat.
 *
 * Logika pengiriman ada di `src/lib/notify-sweep.ts` dan dipakai bersama dengan
 * `/api/cron/notify`. Keduanya aman berjalan bersamaan karena setiap pengiriman
 * diklaim secara atomik (lihat komentar di file tersebut) — satu notifikasi
 * tidak akan terkirim dua kali.
 */
export async function POST() {
  try {
    const currentUser = await requireCurrentUser()
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await sweepUserNotifications(currentUser.id)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      sent: result.sent,
      errors: result.errors,
      skipped: result.skipped,
    })
  } catch (e) {
    return handleApiError('api/notify/run', e)
  }
}
