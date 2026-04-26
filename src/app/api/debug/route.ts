import { NextResponse } from 'next/server'

export async function GET() {
  const dbUrl = process.env.DATABASE_URL || ''
  const directUrl = process.env.DIRECT_DATABASE_URL || ''
  const cookieSecret = process.env.COOKIE_SECRET || ''

  return NextResponse.json({
    hasDatabaseUrl: !!dbUrl,
    databaseUrlPrefix: dbUrl ? dbUrl.substring(0, 60) + '...' : 'MISSING',
    hasDirectUrl: !!directUrl,
    directUrlPrefix: directUrl ? directUrl.substring(0, 60) + '...' : 'MISSING',
    hasCookieSecret: !!cookieSecret,
  })
}
