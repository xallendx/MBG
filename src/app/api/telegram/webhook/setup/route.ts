import { NextRequest, NextResponse } from 'next/server'
import { setTelegramWebhook } from '@/lib/telegram'
import { requireAdmin } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const { error } = await requireAdmin()
    if (error) return error

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN belum diatur di environment' }, { status: 500 })
    }

    const host = req.headers.get('host') || ''
    const protocol = host.includes('localhost') ? 'http' : 'https'
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || undefined

    const result = await setTelegramWebhook(webhookUrl, secretToken)
    return NextResponse.json({
      success: true,
      message: 'Webhook berhasil diatur!',
      webhookUrl,
      result
    })
  } catch (error) {
    return NextResponse.json({ error: 'Request failed' }, { status: 500 })
  }
}
