import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTelegramMessage } from '@/lib/telegram'
import { getNextReadyAt, computeStatus } from '@/lib/schedule'

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
        await sendTelegramMessage(chatId, 'Selamat datang! Kirim /start <kode> untuk menghubungkan akun MBG Anda.')
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

      await sendTelegramMessage(chatId, `✅ Telegram berhasil dihubungkan!\n\nAkun: ${settings.telegramName}\n\nKirim /status untuk melihat ringkasan task Anda.`, 'HTML')
      return NextResponse.json({ ok: true })
    }

    // Handle /status
    if (text === '/status') {
      const matchedUser = await findUserByTelegramChatId(chatId)

      if (!matchedUser) {
        await sendTelegramMessage(chatId, '❌ Akun belum terhubung. Kirim /start <kode> untuk menghubungkan.')
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
          const proj = t.project ? `[${t.project.name}] ` : ''
          lines.push(`• ${proj}${t.name}`)
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
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}
