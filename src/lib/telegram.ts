const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''

const TELEGRAM_API = 'https://api.telegram.org/bot'

export async function sendTelegramMessage(chatId: number | string, text: string, parseMode?: 'HTML' | 'Markdown') {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set')
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  }
  if (parseMode) body.parse_mode = parseMode

  const res = await fetch(`${TELEGRAM_API}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Telegram API error: ${res.status} - ${err}`)
  }

  return res.json()
}

export async function setTelegramWebhook(url: string, secretToken?: string) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set')
  }

  const payload: Record<string, unknown> = {
    url,
    allowed_updates: ['message', 'callback_query'],
  }
  if (secretToken) {
    payload.secret_token = secretToken
  }

  const res = await fetch(`${TELEGRAM_API}${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to set webhook: ${res.status} - ${err}`)
  }

  return res.json()
}
