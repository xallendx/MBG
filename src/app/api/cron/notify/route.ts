import { NextResponse } from 'next/server'
import { runNotificationSweep } from '@/lib/notify-sweep'
import { pruneRateLimits } from '@/lib/rate-limit'
import { pruneTaskLogs } from '@/lib/retention'

/**
 * GET/POST /api/cron/notify
 *
 * Endpoint yang dipanggil oleh penjadwal server (Vercel Cron, GitHub Actions,
 * cron sistem, atau cron eksternal mana pun). Ini yang membuat notifikasi tetap
 * terkirim saat aplikasi **tidak sedang dibuka** — sebelumnya satu-satunya
 * pemicu adalah setInterval di browser, sehingga notifikasi mati begitu tab
 * ditutup.
 *
 * AUTENTIKASI
 * -----------
 * Wajib menyertakan `CRON_SECRET` di environment:
 *   - Vercel Cron otomatis mengirim header `Authorization: Bearer <CRON_SECRET>`
 *   - Cron manual: `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/notify`
 *   - Alternatif untuk layanan yang tidak bisa set header: `?secret=...`
 *
 * Kalau `CRON_SECRET` belum diisi, endpoint menolak semua permintaan (fail
 * closed) — lebih baik tidak ada notifikasi daripada endpoint publik yang bisa
 * dipakai orang lain untuk memicu pengiriman massal.
 *
 * Contoh jadwal: setiap 5 menit (lihat `vercel.json`, cron "every-5-minutes").
 * Catatan: Vercel Hobby hanya mengizinkan cron harian; pakai GitHub Actions
 * atau cron eksternal untuk interval menit.
 */

export const dynamic = 'force-dynamic'

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = req.headers.get('authorization')
  if (auth && auth === `Bearer ${secret}`) return true

  const url = new URL(req.url)
  if (url.searchParams.get('secret') === secret) return true

  return false
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET belum diset di environment' },
      { status: 503 }
    )
  }

  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const userId = url.searchParams.get('userId') || undefined
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, Math.min(2000, parseInt(limitParam, 10) || 500)) : undefined

  const started = Date.now()
  try {
    const result = await runNotificationSweep({ userId, limit })

    // Sekalian bersihkan baris rate limit yang sudah kedaluwarsa agar tabel
    // tidak tumbuh tanpa batas.
    const prunedRateLimits = await pruneRateLimits(24).catch(() => 0)

    // Pangkas riwayat penyelesaian yang sudah lewat masa retensi supaya tabel
    // TaskLog tidak tumbuh selamanya (lihat src/lib/retention.ts).
    const prunedTaskLogs = await pruneTaskLogs().catch(() => 0)

    return NextResponse.json({
      success: true,
      ...result,
      prunedRateLimits,
      prunedTaskLogs,
      durationMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Sweep gagal', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return handle(req)
}

export async function POST(req: Request) {
  return handle(req)
}
