import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTelegramMessage } from '@/lib/telegram'
import { getNextReadyAt, computeStatus } from '@/lib/schedule'
import { logError } from '@/lib/logger'
import { getTimezone, parseSettings } from '@/lib/settings'

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
    const settings = parseSettings(u.settings, 'telegram/webhook:findUserByCode')
    const expiry = Number(settings.telegramCodeExpiry ?? 0)
    if (settings.telegramCode === code && expiry > Date.now()) {
      return u
    }
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
    const settings = parseSettings(u.settings, 'telegram/webhook:findUserByChatId')
    if (String(settings.telegramChatId) === String(chatId)) {
      return u
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    // Fail closed: an unconfigured webhook must not accept forged updates.
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
    if (!webhookSecret) return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET belum diatur' }, { status: 503 })
    const providedToken = req.headers.get('x-telegram-bot-api-secret-token')
    if (providedToken !== webhookSecret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      const settings = parseSettings(matchedUser.settings, 'telegram/webhook:start')
      delete settings.telegramCode
      delete settings.telegramCodeExpiry
      settings.telegramChatId = chatId
      settings.telegramId = String(chatId)
      const telegramName = from
        ? `${from.first_name || ''}${from.last_name ? ' ' + from.last_name : ''}`.trim()
        : 'User'
      settings.telegramName = telegramName

      await db.user.update({
        where: { id: matchedUser.id },
        data: {
          telegramId: String(chatId),
          settings: JSON.stringify(settings)
        }
      })

      await sendTelegramMessage(chatId, `✅ Telegram berhasil dihubungkan!\n\nAkun: ${escHtml(String(settings.telegramName))}\n\nKirim /status untuk melihat ringkasan task Anda.`, 'HTML')
      return NextResponse.json({ ok: true })
    }

    // Handle /status
    if (text === '/status') {
      const matchedUser = await findUserByTelegramChatId(chatId)

      if (!matchedUser) {
        await sendTelegramMessage(chatId, '❌ Akun belum terhubung. Kirim /start &lt;kode&gt; untuk menghubungkan.')
        return NextResponse.json({ ok: true })
      }

      // Get user timezone for schedule calculations
      const userTz = getTimezone(matchedUser.settings, 'telegram/webhook:status')

      const tasks = await db.task.findMany({
        where: { userId: matchedUser.id },
        include: {
          project: true,
          logs: { orderBy: { completedAt: 'desc' } }
        }
      })

      const siapTasks = tasks.filter(t => computeStatus(t, userTz) === 'siap')
      const cdTasks = tasks.filter(t => computeStatus(t, userTz) === 'cooldown')
      const doneTasks = tasks.filter(t => computeStatus(t, userTz) === 'selesai')

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
  } catch (e) {
    // Telegram akan mencoba kirim ulang kalau balasan bukan 200, jadi kegagalan
    // tetap dibalas ok:true — tapi sekarang dicatat, tidak lagi ditelan diam-diam.
    logError('POST /api/telegram/webhook', e)
    return NextResponse.json({ ok: true })
  }
}
