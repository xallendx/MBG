# MBG Airdrop Task Manager

Aplikasi pengelola tugas airdrop dengan tema **Windows 95 retro**. Dibangun menggunakan Next.js 16, Prisma ORM, dan PostgreSQL (Neon).

## Fitur

- **Dashboard** — Ringkasan semua task dengan filter tab (Semua, Siap, CD, Done)
- **Monitor** — Tampilan monitor untuk tracking task aktif
- **Tree View** — Tampilan folder per project dengan status group
- **Auto Cooldown** — Timer cooldown otomatis setelah task diselesaikan
- **Template Task** — Simpan template task untuk dipakai ulang
- **Keyboard Shortcuts** — Shortcut keyboard untuk navigasi cepat
- **Import/Export** — Import dan export project via JSON
- **Share Project** — Bagikan project ke user lain via kode
- **Telegram Notification** — Notifikasi Telegram saat task siap dikerjakan
- **Mobile Responsive** — Mendukung smartphone dengan long-press context menu
- **Notes** — Catatan sticky notes

## Tech Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Database**: PostgreSQL (Neon) + Prisma ORM
- **Auth**: Cookie-based + HMAC signature (bcryptjs)
- **Styling**: Tailwind CSS 4 + Windows 95 custom theme
- **Security**: Rate limiting, HMAC cookies, CORS headers

## Cara Install

### 1. Install dependencies
```bash
bun install
```

### 2. Setup environment
```bash
cp .env.example .env
# Edit .env — isi DATABASE_URL, COOKIE_SECRET, dan TELEGRAM_BOT_TOKEN
```

### 3. Setup database
```bash
bun run db:push
```

### 4. Jalankan aplikasi
```bash
bun run dev
```

Aplikasi berjalan di **http://localhost:3000**

## Login

Gunakan invite code berikut untuk register:

| Role    | Username | Password | Invite Code |
|---------|----------|----------|-------------|
| Admin   | admin1   | admin123 | MBGADMIN    |
| User    | -        | -        | MBGUSER01   |
| User    | -        | -        | MBGUSER02   |

## Deploy ke Vercel

1. Push ke GitHub
2. Import di [vercel.com](https://vercel.com)
3. Set environment variables:
   - `DATABASE_URL` — Neon connection string (pooled + pgbouncer)
   - `DIRECT_DATABASE_URL` — Neon connection string (direct)
   - `COOKIE_SECRET` — Random 64-char hex string
   - `TELEGRAM_BOT_TOKEN` — (opsional) Token bot Telegram
4. Deploy

## Keyboard Shortcuts

| Key | Aksi |
|-----|------|
| N   | Task Baru (di folder aktif) |
| T   | Task Baru (standalone) |
| P   | Project Baru |
| R   | Refresh |
| D   | Dashboard |
| M   | Monitor |
| 1-4 | Tab filter (Semua/Siap/CD/Done) |
| /   | Focus search |
| Esc | Tutup dialog |

## License

Private project — MBG Team
