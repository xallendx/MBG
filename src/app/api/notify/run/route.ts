import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTelegramMessage } from '@/lib/telegram'
import { getNextReadyAt } from '@/lib/schedule'
import { requireCurrentUser } from '@/lib/auth'
import webpush from 'web-push'

// Configure VAPID
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@mbg.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Helper: send web push notification
async function sendWebPush(userId: string, title: string, body: string, tag: string) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false

  try {
    const subscriptions = await db.pushSubscription.findMany({
      where: { userId }
    })

    if (subscriptions.length === 0) return false

    let sent = 0
    for (const sub of subscriptions) {
      try {
        const keys = JSON.parse(sub.keys)
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: { auth: keys.auth, p256dh: keys.p256dh }
        }
        await webpush.sendNotification(pushSubscription, JSON.stringify({ title, body, tag, url: '/' }), {
          TTL: 60, // 60 seconds
          urgency: 'normal'
        })
        sent++
      } catch (err) {
        // If subscription is invalid/expired, remove it
        if (err instanceof Error && (err as Error & { statusCode?: number }).statusCode === 410) {
          await db.pushSubscription.delete({ where: { id: sub.id } })
        }
      }
    }
    return sent > 0
  } catch {
    return false
  }
}

// POST /api/notify/run — dipanggil oleh frontend setiap 30 detik
// Cek task user saat ini yang punya Telegram/Push, kirim notif jika perlu
export async function POST() {
  try {
    const currentUser = await requireCurrentUser()
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const now = Date.now()
    let sentCount = 0
    let errorCount = 0

    // Get the current user's full data with settings
    const user = await db.user.findUnique({
      where: { id: currentUser.id },
      select: { id: true, username: true, displayName: true, settings: true }
    })

    if (!user) return NextResponse.json({ success: true, sent: 0, errors: 0 })

    let settings: Record<string, unknown>
    try { settings = JSON.parse(user.settings) } catch { return NextResponse.json({ success: true, sent: 0, errors: 0 }) }

    // Check if ANY notification channel is enabled
    const telegramEnabled = settings.telegramNotifEnabled !== false && !!settings.telegramChatId
    const pushEnabled = settings.browserNotifEnabled !== false // default enabled

    if (!telegramEnabled && !pushEnabled) return NextResponse.json({ success: true, sent: 0, errors: 0 })

    // Get all tasks for this user that are in cooldown (have logs, scheduleType not sekali)
    const tasks = await db.task.findMany({
      where: {
        userId: user.id,
        scheduleType: { not: 'sekali' },
        logs: { some: {} }
      },
      include: {
        project: { select: { name: true } },
        logs: { orderBy: { completedAt: 'desc' }, take: 1 }
      }
    })

    for (const task of tasks) {
      const nextReady = getNextReadyAt(task)
      if (!nextReady) continue

      const msUntilReady = nextReady.getTime() - now
      const projName = task.project ? `[${escHtml(task.project.name)}] ` : ''
      const taskLabel = `${projName}${escHtml(task.name)}`
      const displayName = escHtml(user.displayName || user.username)

      // ---- Notif 2 menit sebelum siap ----
      if (msUntilReady > 0 && msUntilReady <= 120000 && !task.notifiedWarnAt) {
        const minutesLeft = Math.ceil(msUntilReady / 60000)
        const secondsLeft = Math.ceil(msUntilReady / 1000)
        let timeText = ''
        if (minutesLeft >= 1) timeText = `${minutesLeft} menit`
        else timeText = `${secondsLeft} detik`

        // Telegram notification
        if (telegramEnabled) {
          try {
            await sendTelegramMessage(
              settings.telegramChatId as string | number,
              `⏰ <b>Hampir Siap!</b>\n\n` +
              `📋 ${taskLabel}\n` +
              `⏱ Siap dalam: ${timeText}\n` +
              `👤 ${displayName}`,
              'HTML'
            )
          } catch {
            errorCount++
          }
        }

        // Web Push notification
        if (pushEnabled) {
          try {
            await sendWebPush(user.id, `⏰ ${task.name}`, `Siap dalam ${timeText}`, `warn-${task.id}`)
          } catch {
            errorCount++
          }
        }

        await db.task.update({
          where: { id: task.id },
          data: { notifiedWarnAt: new Date() }
        })
        sentCount++
      }

      // ---- Notif saat task sudah siap ----
      // Also send warn if warn was missed (task jumped from >2min to ready between polls)
      if (msUntilReady <= 0 && !task.notifiedReadyAt) {
        // If warn was never sent and task is ready, send warn first then ready
        if (!task.notifiedWarnAt) {
          if (telegramEnabled) {
            try {
              await sendTelegramMessage(
                settings.telegramChatId as string | number,
                `⏰ <b>Hampir Siap!</b>\n\n` +
                `📋 ${taskLabel}\n` +
                `⏱ Siap sekarang!\n` +
                `👤 ${displayName}`,
                'HTML'
              )
            } catch { /* non-critical */ }
          }
          if (pushEnabled) {
            try {
              await sendWebPush(user.id, `⏰ ${task.name}`, 'Siap sekarang!', `warn-${task.id}`)
            } catch { /* non-critical */ }
          }
          await db.task.update({
            where: { id: task.id },
            data: { notifiedWarnAt: new Date() }
          })
        }

        // Telegram notification
        if (telegramEnabled) {
          try {
            await sendTelegramMessage(
              settings.telegramChatId as string | number,
              `✅ <b>Task Siap Dikerjakan!</b>\n\n` +
              `📋 ${taskLabel}\n` +
              `👤 ${displayName}`,
              'HTML'
            )
          } catch {
            errorCount++
          }
        }

        // Web Push notification
        if (pushEnabled) {
          try {
            await sendWebPush(user.id, `✅ ${task.name}`, 'Task siap dikerjakan!', `ready-${task.id}`)
          } catch {
            errorCount++
          }
        }

        await db.task.update({
          where: { id: task.id },
          data: { notifiedReadyAt: new Date() }
        })
        sentCount++
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      sent: sentCount,
      errors: errorCount
    })
  } catch {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
