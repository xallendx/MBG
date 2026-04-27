import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTelegramMessage } from '@/lib/telegram'
import { getNextReadyAt, computeStatus } from '@/lib/schedule'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// In-memory rate limiting for /start code attempts: chatId -> { count, windowStart }
const startAttempts = new Map<number, { count: number; windowStart: number }>()
const MAX_START_ATTEMPTS = 5
const START_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function checkRateLimit(chatId: number): boolean {
  const now = Date.now()
  const entry = startAttempts.get(chatId)
  if (!entry || now - entry.windowStart > START_WINDOW_MS) {
    startAttempts.set(chatId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= MAX_START_ATTEMPTS) {
    return false
  }
  entry.count++
  return true
}

// Helper: cari user dengan telegramCode yang cocok
async function findUserByTelegramCode(code: string) {
  // Fix A7: gunakan filter settings contains untuk efisiensi, bukan scan semua
  const candidates = await db.user.findMany({
    where: { settings: { contains: code } },
    select: { id: true, settings: true }
  })
  for (const u of candidates) {
    try {
      const settings = JSON.parse(u.settings)
      if (settings.telegramCode === code && settings.telegramCodeExpiry > Date.now()) {
        return u
      }
    } catch { /* skip */ }
  }
  return null
}

// Helper: cari user dengan telegramChatId yang cocok
async function findUserByTelegramChatId(chatId: number) {
  const chatIdStr = String(chatId)
  const candidates = await db.user.findMany({
    where: { settings: { contains: chatIdStr } },
    select: { id: true, settings: true }
  })
  for (const u of candidates) {
    try {
      const settings = JSON.parse(u.settings)
      if (settings.telegramChatId === chatId) {
        return u
      }
    } catch { /* skip */ }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    // Verify secret_token if TELEGRAM_WEBHOOK_SECRET is configured
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (webhookSecret) {
      const providedToken = req.headers.get('x-telegram-bot-api-secret-token')
      if (providedToken !== webhookSecret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await req.json()
    const message = body.message
    if (!message || !message.text) {
      return NextResponse.json({ ok: true })
    }

    const chatId = message.chat.id
    const text = message.text.trim()
    const from = message.from

    // Handle /start <code>
    if (text.startsWith('/start')) {
      const code = text.replace('/start', '').trim()
      if (!code) {
        await sendTelegramMessage(chatId, 'Selamat datang! Kirim /start &lt;kode&gt; untuk menghubungkan akun MBG Anda.')
        return NextResponse.json({ ok: true })
      }

      // Rate limit check
      if (!checkRateLimit(chatId)) {
        await sendTelegramMessage(chatId, '⚠️ Terlalu banyak percobaan. Coba lagi dalam 15 menit.')
        return NextResponse.json({ ok: true })
      }

      const matchedUser = await findUserByTelegramCode(code)

      if (!matchedUser) {
        await sendTelegramMessage(chatId, '❌ Kode tidak valid atau sudah kadaluarsa. Buka MBG → Alat → Telegram → Generate Kode untuk mendapatkan kode baru.')
        return NextResponse.json({ ok: true })
      }

      // Link Telegram
      const settings = JSON.parse(matchedUser.settings)
      delete settings.telegramCode
      delete settings.telegramCodeExpiry
      settings.telegramChatId = chatId
      settings.telegramId = String(chatId)
      settings.telegramName = from ? `${from.first_name || ''}${from.last_name ? ' ' + from.last_name : ''}`.trim() : 'User'

      await db.user.update({
        where: { id: matchedUser.id },
        data: {
          telegramId: String(chatId),
          settings: JSON.stringify(settings)
        }
      })

      await sendTelegramMessage(chatId, `✅ Telegram berhasil dihubungkan!\n\nAkun: ${escHtml(settings.telegramName)}\n\nKirim /status untuk melihat ringkasan task Anda.`, 'HTML')
      return NextResponse.json({ ok: true })
    }

    // Handle /status
    if (text === '/status') {
      const matchedUser = await findUserByTelegramChatId(chatId)

      if (!matchedUser) {
        await sendTelegramMessage(chatId, '❌ Akun belum terhubung. Kirim /start &lt;kode&gt; untuk menghubungkan.')
        return NextResponse.json({ ok: true })
      }

      const tasks = await db.task.findMany({
        where: { userId: matchedUser.id },
        include: {
          project: true,
          logs: { orderBy: { completedAt: 'desc' } }
        }
      })

      const siapTasks = tasks.filter(t => computeStatus(t) === 'siap')
      const cdTasks = tasks.filter(t => computeStatus(t) === 'cooldown')
      const doneTasks = tasks.filter(t => computeStatus(t) === 'selesai')

      const lines = [
        '📊 <b>Ringkasan Task MBG</b>',
        '',
        `✅ Siap: ${siapTasks.length}`,
        `⏳ Cooldown: ${cdTasks.length}`,
        `✔️ Selesai: ${doneTasks.length}`,
        `📁 Total: ${tasks.length}`,
      ]

      if (siapTasks.length > 0) {
        lines.push('', '<b>📋 Siap Dikerjakan:</b>')
        siapTasks.slice(0, 10).forEach(t => {
          const proj = t.project ? `[${escHtml(t.project.name)}] ` : ''
          lines.push(`• ${proj}${escHtml(t.name)}`)
        })
        if (siapTasks.length > 10) {
          lines.push(`  ... dan ${siapTasks.length - 10} lainnya`)
        }
      }

      await sendTelegramMessage(chatId, lines.join('\n'), 'HTML')
      return NextResponse.json({ ok: true })
    }

    // Unknown command
    await sendTelegramMessage(chatId, 'Perintah tidak dikenali. Kirim /status untuk melihat ringkasan task.')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
