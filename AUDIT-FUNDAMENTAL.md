# Audit Fundamental — MBG Airdrop Task Manager

Bukan review tampilan. Ini daftar hal yang **menentukan apakah produk ini bisa
diandalkan**, dengan bukti baris kode dari repo `xallendx/MBG`.

Kesimpulan singkat: **UI polish yang aku kerjakan tadi bukan masalah utamanya.**
Masalah utamanya ada 3, dan salah satunya membuat janji inti produk gagal.

---

## Ringkasan prioritas

> **Update:** ketiga temuan P0 sudah diperbaiki dan diverifikasi.
> Detail bukti ada di [`PERBAIKAN-FUNDAMENTAL.md`](./PERBAIKAN-FUNDAMENTAL.md).
> Dokumen di bawah ini dipertahankan sebagai catatan temuan awal.

| # | Temuan | Tingkat | Status |
|---|---|---|---|
| 1 | Notifikasi hanya hidup saat tab terbuka | **P0** | ✅ **SELESAI** — lihat `PERBAIKAN-FUNDAMENTAL.md` |
| 2 | Tanpa migration & tanpa test | **P0** | ✅ **SELESAI** — migration + 23 test + CI |
| 3 | Rate limiter in-memory di serverless | **P0** | ✅ **SELESAI** — tabel `RateLimit` + batas per IP & per akun |
| 4 | State management manual 4.151 baris, padahal react-query sudah terpasang | **P1** | ⚠️ **BELUM** — dependency react-query justru dihapus (memang tidak dipakai); `page.tsx` masih ~4.169 baris |
| 5 | Validasi input ad-hoc + 61 `catch {}` | **P1** | ✅ **SELESAI** — zod + `handleApiError`, sisa `catch {}` hanya fallback `JSON.parse` |
| 6 | Dua implementasi daftar task (dashboard & tree) | **P1** | ✅ **SELESAI (aturan)** — label/prioritas/cooldown kini satu modul `src/lib/task-view.ts`; markup tiap view tetap terpisah |
| 7 | Settings disimpan sebagai string JSON | **P2** | ✅ **SELESAI (pembacaan)** — `src/lib/settings.ts` memvalidasi + default; normalisasi kolom belum |
| 8 | Polling 60 detik menarik semua data | **P2** | ✅ **SELESAI** — dilewati saat tab tidak aktif |
| 9 | TaskLog tumbuh tanpa batas | **P2** | ✅ **SELESAI** — retensi 730 hari via cron |
| 10 | Share project menyimpan JSON beku | **P2** | ⚠️ **BELUM** — masih snapshot beku |
| 11 | Tidak ada observability & CI | **P2** | ✅ CI + log JSON terstruktur; error tracking (Sentry) belum |

---

## P0-1 · Notifikasi mati kalau aplikasi ditutup

**Bukti:**
- `src/app/page.tsx:763-768`
  ```js
  // Scheduler: panggil /api/notify/run setiap 30 detik untuk Telegram notif
  const run = async () => { try { await fetch('/api/notify/run', ...) } catch {} }
  const iv = setInterval(run, 60000)
  ```
- `src/app/api/notify/run/route.ts` memakai `requireCurrentUser()` → butuh sesi user.
- Tidak ada `vercel.json`, tidak ada cron, tidak ada worker.

**Artinya:** notifikasi Telegram dan web push **hanya terkirim kalau tab MBG sedang
terbuka**. Padahal alur pakainya justru: tinggalkan task, tutup browser, tunggu
cooldown selesai, lalu dikabari. Itu tidak terjadi.

**Perbaikan:**
1. Tambah `NotificationJob` (userId, taskId, dueAt, sentAt) yang dibuat saat task
   diselesaikan.
2. Cron server (Vercel Cron / `pg_cron`) memanggil endpoint internal dengan
   secret header, mengirim notifikasi yang `dueAt <= now` **dan** `sentAt IS NULL`.
3. Idempotensi wajib: `sentAt` di-set dalam transaksi yang sama dengan pengiriman.
4. `api/notify/run` yang sekarang diubah jadi untuk "catch-up saat app dibuka".

**Dampak kalau tidak dikerjakan:** produk tidak memenuhi fungsinya. Ini bukan bug
kecil; ini alasan orang memakai aplikasi ini.

## P0-2 · Tanpa migration & tanpa test

**Bukti:**
- `prisma/` hanya berisi `schema.prisma`. Tidak ada folder `migrations/`.
- Script: `"db:push": "prisma db push"` — di Neon ini bisa memicu reset/kehilangan
  data saat perubahan tidak kompatibel.
- Tidak ada test runner di `package.json`; `src/lib/schedule.ts` (194 baris logika
  cooldown + timezone) berisi komentar `BUG FIX` berulang tanpa satu pun test.

**Perbaikan:**
1. `prisma migrate dev` → commit folder `migrations/`. Hapus ketergantungan `db:push`
   untuk produksi.
2. Vitest + 20–30 test untuk `schedule.ts`: harian/mingguan/jam_tertentu,
   WIB vs WITA, tengah malam, cooldown 0 jam, config rusak.
3. CI (GitHub Actions): `tsc --noEmit`, `next build`, `vitest run`.

## P0-3 · Rate limiter tidak berfungsi di serverless

**Bukti:** `src/app/api/auth/login/route.ts:7` dan `register/route.ts:5-17`
memakai `Map` di level modul. Di Vercel setiap instance punya memori sendiri dan
cold start menghapusnya.

**Artinya:** "maksimal 5 percobaan per 15 menit" tidak benar-benar berlaku —
penyerang cukup memicu instance baru atau menembak paralel.

**Perbaikan:** hitungan di Postgres (`LoginAttempt` + index waktu) atau Upstash
Redis; kunci per IP + per username/kode, bukan hanya per kode undangan.

---

## P1-4 · State management manual — akar dari banyak bug

`src/app/page.tsx` = **4.151 baris** dan berisi mekanisme yang seharusnya tidak
perlu ditulis tangan:

- `tasksCacheRef`, `projectsCacheRef`, `notesCacheRef`, `settingsCacheRef`
- `lastWriteTime` + `SKIP_FETCH_AFTER_WRITE_MS` untuk mencegah fetch menimpa
  optimistic update
- polling 60 detik + `delayedFetch()` + `saveToCache()` tiap 10 detik

Semua ini gejala dari satu hal: **tidak ada single source of truth untuk data
server**. Sementara `@tanstack/react-query` sudah ada di `package.json` dengan
**0 pemakaian** (begitu juga `zod` dan `@dnd-kit`).

**Perbaikan:** adopsi react-query (`useQuery` untuk `/api/init`, `useMutation` +
`invalidateQueries` untuk complete/undo/reset). Ini menghapus ratusan baris kode
sinkronisasi manual dan menghilangkan kelas bug "data balik ke kondisi lama".

## P1-5 · Validasi ad-hoc & error yang ditelan

- 40 route API, validasi manual per route, `zod` **0 pemakaian**.
- **61** `catch {}` / `catch (e) {}` di `src/app/api` dan `src/lib` yang menelan
  error tanpa log terstruktur.

**Perbaikan:** satu helper `parseBody(schema)` di semua route + `handleApiError()`
seragam; ganti `catch {}` dengan log yang menyertakan route + userId + kode error.

## P1-6 · Dua implementasi daftar task

`renderDashboard()` dan cabang `viewMode === 'tree'` sama-sama merender folder,
status group, dan baris task dengan kode berbeda. Bukti nyata: perbaikan label
`CD`/`Done` dan pesan kosong tadi harus aku terapkan di **tiga tempat**.

**Perbaikan:** satu komponen `TaskList` dengan props (filter, expand, density);
pilih view lewat konfigurasi, bukan lewat dua salinan JSX.

---

## P2 dan sekitarnya

- **Settings sebagai string JSON** (`User.settings`, `Task.scheduleConfig`):
  di-parse di banyak tempat dengan `try/catch`, typo diabaikan. Idealnya kolom
  bertipe atau paling tidak divalidasi zod saat masuk.
- **Polling boros**: `/api/init` menarik tasks + projects + notes + templates
  setiap 60 detik per tab. Belum ada `updatedAt` cursor/ETag, jadi data identik
  tetap dikirim ulang.
- **TaskLog tanpa retensi**: `_count` dan `take: 1` menyelamatkan query, tapi tabel
  tumbuh selamanya. Perlu arsip/rolling window.
- **SharedProject menyimpan `projectData` JSON beku**: share code tidak bisa
  menerima update; user yang import dapat snapshot kuno.
- **Observability**: error hanya `console.error`. Tidak ada error tracking, tidak
  ada health check, tidak ada metrik notifikasi gagal.
- **Tidak ada CI**: tidak ada `.github/workflows`; `next build` hanya dijalankan manual.
- **Dependency zombie**: 27 paket `@radix-ui/*`, 47 file `components/ui/*`,
  plus `zustand`, `zod`, `@dnd-kit`, `@tanstack/react-query` — semuanya **0 referensi**.
  Beban install & build naik, upgrade Next 16 → 17 nanti menyakitkan.

---

## Yang justru sudah bagus (biar seimbang)

- **Header keamanan lengkap** di `next.config.ts`: CSP, HSTS, `X-Frame-Options`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader: false`.
- **Cookie sesi benar**: `httpOnly`, `secure` di produksi, `sameSite: 'lax'`,
  ditandatangani HMAC dengan `timingSafeEqual`.
- **`requireUser()` mengecek `isBlocked` di setiap request** — blokir admin berlaku
  seketika, bukan menunggu cookie kedaluwarsa.
- **Logika timezone serius**: memakai `Intl` offset, bukan asumsi UTC+7.
- **Optimistic update + rollback** sudah ada (jarang di proyek sebesar ini).
- **Endpoint `undo` sudah tersedia** sejak dulu — tinggal dipakai.

---

## Urutan kerja yang aku sarankan

**Sprint 1 — bikin bisa dipercaya (1–2 hari)**
1. Cron notifikasi + tabel `NotificationJob` (P0-1)
2. `prisma migrate` + 25 test `schedule.ts` (P0-2)
3. Rate limit berbasis DB (P0-3)

**Sprint 2 — bikin bisa dikembangkan (2–3 hari)**
4. react-query menggantikan cache refs manual (P1-4)
5. zod di semua route + error handler seragam (P1-5)
6. Satukan dua implementasi daftar task (P1-6)

**Sprint 3 — bersih-bersih (1 hari)**
7. Buang dependency zombie, tambah CI, error tracking, retensi TaskLog.

Kalau hanya boleh satu: **P0-1**. Karena tanpa itu, aplikasi ini tidak melakukan
hal yang membuat orang memakainya.
