/**
 * Notification sweep — satu-satunya tempat logika pengiriman notifikasi.
 *
 * KENAPA FILE INI ADA
 * -------------------
 * Sebelumnya seluruh logika notifikasi berada di dalam route
 * `POST /api/notify/run`, dan route itu hanya dipanggil oleh browser lewat
 * setInterval. Akibatnya notifikasi Telegram & Web Push **hanya terkirim kalau
 * tab MBG sedang terbuka** — padahal justru saat tab ditutup notifikasi paling
 * dibutuhkan.
 *
 * Sekarang logikanya dipindah ke sini agar bisa dipanggil dari dua tempat:
 *   1. `/api/cron/notify`  → dijalankan server (Vercel Cron / cron eksternal),
 *      bekerja walau tidak ada browser yang terbuka.
 *   2. `/api/notify/run`   → dipanggil browser, berfungsi sebagai "catch-up"
 *      saat aplikasi baru dibuka (dan untuk pengguna yang tidak mengaktifkan cron).
 *
 * IDEMPOTENSI
 * -----------
 * Dua pemanggil bisa berjalan bersamaan (cron + tab yang terbuka). Setiap
 * pengiriman diklaim lebih dulu dengan `updateMany` bersyarat pada kolom
 * `notifiedWarnAt` / `notifiedReadyAt` yang masih NULL. Hanya pemanggil yang
 * berhasil mengubah baris (count > 0) yang benar-benar mengirim. Ini menjamin
 * satu notifikasi tidak terkirim dua kali.
 *
 * Kolom penanda direset ke NULL saat task di-complete / di-reset / jadwalnya
 * diubah, sehingga siklus cooldown berikutnya bisa memberi notifikasi lagi.
 */
import { db } from '@/lib/db'
import { getNextReadyAt } from '@/lib/schedule'
import { getTimezone, resolveSettings } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/telegram'
import webpush from 'web-push'
import { isAllowedPushEndpoint } from './push-endpoint'
import { isNotificationCandidate } from './notify-eligible'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@mbg.app'

let vapidReady = false
function ensureVapid() {
  if (vapidReady) return true
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  vapidReady = true
  return true
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function errorsForUnsafePushEndpoint() {
  console.warn('[push] endpoint tidak didukung; tidak dikirim')
}

async function sendWebPush(userId: string, title: string, body: string, tag: string): Promise<boolean> {
  if (!ensureVapid()) return false

  const subscriptions = await db.pushSubscription.findMany({ where: { userId } })
  if (subscriptions.length === 0) return false

  let sent = 0
  for (const sub of subscriptions) {
    // Old stored entries are also checked; never call arbitrary endpoints.
    if (!isAllowedPushEndpoint(sub.endpoint)) { errorsForUnsafePushEndpoint(); continue }
    try {
      const keys = JSON.parse(sub.keys)
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } },
        JSON.stringify({ title, body, tag, url: '/' }),
        { TTL: 60, urgency: 'normal' }
      )
      sent++
    } catch (err) {
      // 404/410 = subscription mati, hapus supaya tidak dicoba terus
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      }
    }
  }
  return sent > 0
}

export type SweepResult = {
  usersChecked: number
  sent: number
  errors: number
  skipped?: string
}

/**
 * Jalankan sweep untuk satu user (dipakai oleh cron per-user maupun endpoint catch-up).
 */
export async function sweepUserNotifications(userId: string): Promise<SweepResult> {
  const now = Date.now()
  let sent = 0
  let errors = 0

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, settings: true, isBlocked: true },
  })

  if (!user || user.isBlocked) return { usersChecked: 1, sent: 0, errors: 0, skipped: 'user-tidak-aktif' }

  // Nilai tidak valid (mis. notifyBeforeCooldownMin berupa string) tidak lagi
  // membuat perhitungan notifikasi meleset — resolveSettings mengembalikan
  // default yang aman, dan settings rusak total tidak lagi melewati user ini.
  const settings = resolveSettings(user.settings, 'notify-sweep')

  const telegramEnabled = settings.telegramNotifEnabled !== false && !!settings.telegramChatId
  const pushEnabled = settings.browserNotifEnabled !== false // default aktif

  if (!telegramEnabled && !pushEnabled) {
    return { usersChecked: 1, sent: 0, errors: 0, skipped: 'semua-channel-mati' }
  }

  // Tugas terjadwal ikut diperiksa walau belum pernah diselesaikan: dulu
  // syarat `logs: { some: {} }` membuat tugas baru tidak pernah dikabari pada
  // siklus pertamanya (lihat lib/notify-eligible.ts). Tugas "Sekali" tetap
  // dikecualikan karena selalu siap sejak dibuat.
  const tasks = await db.task.findMany({
    where: { userId: user.id, scheduleType: { not: 'sekali' } },
    include: {
      project: { select: { name: true } },
      logs: { orderBy: { completedAt: 'desc' }, take: 1 },
    },
  })

  const notifyBeforeMs = Number(settings.notifyBeforeCooldownMin ?? 5) * 60 * 1000
  const displayName = escHtml(user.displayName || user.username)

  for (const task of tasks) {
    const nextReady = getNextReadyAt(task, getTimezone(user.settings, 'notify-sweep'))
    if (!nextReady) continue

    const msUntilReady = nextReady.getTime() - now
    if (!isNotificationCandidate(
      { scheduleType: task.scheduleType, hasLogs: task.logs.length > 0 },
      true,
      msUntilReady,
    )) continue

    const projName = task.project ? `[${escHtml(task.project.name)}] ` : ''
    const taskLabel = `${projName}${escHtml(task.name)}`

    // ---- 1. Peringatan X menit sebelum cooldown selesai ----
    if (msUntilReady > 0 && msUntilReady <= notifyBeforeMs && !task.notifiedWarnAt) {
      const minutesLeft = Math.ceil(msUntilReady / 60000)
      const timeText = minutesLeft >= 1
        ? `${minutesLeft} menit`
        : `${Math.ceil(msUntilReady / 1000)} detik`

      const claimed = await db.task.updateMany({
        where: { id: task.id, notifiedWarnAt: null },
        data: { notifiedWarnAt: new Date() },
      })

      if (claimed.count > 0) {
        if (telegramEnabled) {
          try {
            await sendTelegramMessage(
              settings.telegramChatId as string | number,
              `⏰ <b>Hampir Siap!</b>\n\n📋 ${taskLabel}\n⏱ Siap dalam: ${timeText}\n👤 ${displayName}`,
              'HTML'
            )
          } catch { errors++ }
        }
        if (pushEnabled) {
          try {
            await sendWebPush(user.id, `⏰ ${task.name}`, `Siap dalam ${timeText}`, `warn-${task.id}`)
          } catch { errors++ }
        }
        sent++
      }
    }

    // ---- 2. Task sudah siap ----
    if (msUntilReady <= 0 && !task.notifiedReadyAt) {
      // Kalau peringatan "hampir siap" terlewat (mis. aplikasi lama tertutup),
      // JANGAN kirim susulan "Hampir Siap — siap sekarang"; itu cuma jadi dua
      // pesan untuk satu kejadian. Cukup tandai warn sebagai terkirim, lalu
      // kirim satu notifikasi "siap".
      if (!task.notifiedWarnAt) {
        await db.task.updateMany({
          where: { id: task.id, notifiedWarnAt: null },
          data: { notifiedWarnAt: new Date() },
        })
      }

      const claimedReady = await db.task.updateMany({
        where: { id: task.id, notifiedReadyAt: null },
        data: { notifiedReadyAt: new Date() },
      })

      if (claimedReady.count > 0) {
        if (telegramEnabled) {
          try {
            await sendTelegramMessage(
              settings.telegramChatId as string | number,
              `✅ <b>Task Siap Dikerjakan!</b>\n\n📋 ${taskLabel}\n👤 ${displayName}`,
              'HTML'
            )
          } catch { errors++ }
        }
        if (pushEnabled) {
          try {
            await sendWebPush(user.id, `✅ ${task.name}`, 'Task siap dikerjakan!', `ready-${task.id}`)
          } catch { errors++ }
        }
        sent++
      }
    }
  }

  return { usersChecked: 1, sent, errors }
}

/**
 * Sweep untuk semua user aktif — dipakai oleh cron.
 * `limit` berguna agar satu eksekusi tidak kehabisan waktu saat user banyak.
 */
export async function runNotificationSweep(opts?: { userId?: string; limit?: number }): Promise<SweepResult> {
  if (opts?.userId) return sweepUserNotifications(opts.userId)

  const users = await db.user.findMany({
    where: { isBlocked: false },
    select: { id: true },
    take: opts?.limit ?? 500,
    orderBy: { updatedAt: 'asc' }, // rotasi: yang paling lama tidak aktif ditangani dulu
  })

  let sent = 0
  let errors = 0
  for (const u of users) {
    try {
      const r = await sweepUserNotifications(u.id)
      sent += r.sent
      errors += r.errors
    } catch {
      errors++
    }
  }

  return { usersChecked: users.length, sent, errors }
}
