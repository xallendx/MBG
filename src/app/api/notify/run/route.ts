import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTelegramMessage } from '@/lib/telegram'
import { getNextReadyAt } from '@/lib/schedule'
import { getCurrentUser } from '@/lib/auth'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// POST /api/notify/run — dipanggil oleh frontend setiap 30 detik
// Cek task user saat ini yang punya Telegram, kirim notif jika perlu
export async function POST() {
  try {
    const currentUser = await getCurrentUser()
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

    const telegramChatId = settings.telegramChatId
    if (!telegramChatId) return NextResponse.json({ success: true, sent: 0, errors: 0 })

    // Check if user enabled Telegram notifications (default: enabled)
    if (settings.telegramNotifEnabled === false) return NextResponse.json({ success: true, sent: 0, errors: 0 })

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
      if (msUntilReady > 0 && msUntilReady <= 130000 && !task.notifiedWarnAt) {
        const minutesLeft = Math.ceil(msUntilReady / 60000)
        const secondsLeft = Math.ceil(msUntilReady / 1000)
        let timeText = ''
        if (minutesLeft >= 1) timeText = `${minutesLeft} menit`
        else timeText = `${secondsLeft} detik`

        try {
          await sendTelegramMessage(
            telegramChatId as string | number,
            `⏰ <b>Hampir Siap!</b>\n\n` +
            `📋 ${taskLabel}\n` +
            `⏱ Siap dalam: ${timeText}\n` +
            `👤 ${displayName}`,
            'HTML'
          )
          await db.task.update({
            where: { id: task.id },
            data: { notifiedWarnAt: new Date() }
          })
          sentCount++
        } catch {
          errorCount++
        }
      }

      // ---- Notif saat task sudah siap ----
      if (msUntilReady <= 0 && !task.notifiedReadyAt) {
        try {
          await sendTelegramMessage(
            telegramChatId as string | number,
            `✅ <b>Task Siap Dikerjakan!</b>\n\n` +
            `📋 ${taskLabel}\n` +
            `👤 ${displayName}`,
            'HTML'
          )
          await db.task.update({
            where: { id: task.id },
            data: { notifiedReadyAt: new Date() }
          })
          sentCount++
        } catch {
          errorCount++
        }
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
