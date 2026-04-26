import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Simple in-memory rate limiter for share preview (prevent abuse of accessCount increment)
// Fix B10: Auto-cleanup stale entries when map grows
const sharePreviewCounts = new Map<string, { count: number; resetAt: number }>()
const SHARE_PREVIEW_MAX_PER_HOUR = 30

function isRateLimited(code: string): boolean {
  const now = Date.now()
  // Periodic cleanup: remove expired entries when map grows
  if (sharePreviewCounts.size > 100) {
    for (const [k, v] of sharePreviewCounts) {
      if (now > v.resetAt) sharePreviewCounts.delete(k)
    }
  }
  const entry = sharePreviewCounts.get(code)
  if (!entry || now > entry.resetAt) {
    sharePreviewCounts.set(code, { count: 1, resetAt: now + 3600000 })
    return false
  }
  if (entry.count >= SHARE_PREVIEW_MAX_PER_HOUR) return true
  entry.count++
  return false
}

// GET /api/share/[code] — Preview shared project data
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: 'Kode tidak valid' }, { status: 400 })
  }

  const shared = await db.sharedProject.findUnique({ where: { code } })
  if (!shared) return NextResponse.json({ error: 'Kode tidak ditemukan' }, { status: 404 })

  // Rate limit check — still return data but skip increment
  if (isRateLimited(code)) {
    try {
      const data = JSON.parse(shared.projectData)
      // Fix B2: createdAt must be inside the response body, not as NextResponse.json option
      return NextResponse.json({ project: data.project, taskCount: data.tasks?.length || 0, createdAt: shared.createdAt })
    } catch {
      return NextResponse.json({ project: {}, taskCount: 0, createdAt: shared.createdAt })
    }
  }

  await db.sharedProject.update({
    where: { code },
    data: { accessCount: { increment: 1 } }
  })

  try {
    const data = JSON.parse(shared.projectData)
    return NextResponse.json({
      project: data.project,
      taskCount: data.tasks?.length || 0,
      createdAt: shared.createdAt
    })
  } catch {
    return NextResponse.json({ error: 'Data tidak valid' }, { status: 500 })
  }
}
