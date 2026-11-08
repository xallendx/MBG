import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { handleApiError } from '@/lib/api'

// Download endpoint — disabled on Vercel (no filesystem access)
// On self-hosted deployments, this serves a local zip file
export async function GET() {
  const userId = await requireUser()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  // Check if running on Vercel (serverless environment)
  if (process.env.VERCEL) {
    return NextResponse.json({ error: 'Fitur download tidak tersedia di versi cloud' }, { status: 404 })
  }

  // Self-hosted only: read local zip file
  try {
    const fs = await import('fs')
    const path = await import('path')
    const zipPath = path.join(process.cwd(), 'mbg-airdrop-task-manager.zip')

    if (!fs.existsSync(zipPath)) {
      return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 404 })
    }

    const buffer = fs.readFileSync(zipPath)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="mbg-airdrop-task-manager.zip"',
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (e) {
    return handleApiError('GET /api/download', e)
  }
}
