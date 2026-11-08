# Perbaikan User Friendly — MBG Airdrop Task Manager

Semua perubahan di bawah ini sudah **dijalankan dan diverifikasi** di aplikasi
(Postgres lokal + data contoh 9 task / 4 project), bukan hanya ditulis.
Screenshot bukti ada di `../shots/`.

Ringkasan: 4 file berubah, +339 / −74 baris.

| File | Apa yang berubah |
|---|---|
| `src/app/page.tsx` | Undo, label, navigasi, monitor, empty state, form daftar |
| `src/app/api/auth/register/route.ts` | Bootstrap user pertama + status endpoint |
| `src/app/globals.css` | Kontras teks, toolbar mobile, lebar layout, gaya toast |
| `README.md` | Instruksi akun pertama (tidak lagi menyesatkan) |

---

## 1. Undo untuk aksi "Selesai" (paling terasa)

**Sebelum:** klik "Selesai" → task langsung hilang dari daftar, notifikasi hanya
teks yang lewat dalam 2,5 detik. Salah pencet = task "hilang" tanpa jalan kembali.

**Sesudah:** notifikasi membawa tombol **↩ Undo** dan bertahan **8 detik**,
plus tombol tutup (✕) manual. Berlaku juga untuk **"Complete Semua Siap"**
(toast: "7 task sekaligus diselesaikan" + "Undo semua").

Memakai endpoint `POST /api/tasks/[id]/undo` yang sudah ada tapi tidak pernah
dipakai UI. Undo menghapus log terakhir server-side lalu refresh, jadi cooldown
ikut kembali ke kondisi sebenarnya.

Terverifikasi: task "Swap di DEX testnet" → Selesai → Undo → task kembali muncul
di daftar Siap.

## 2. Instalasi baru akhirnya bisa dipakai

**Sebelum:** database kosong → tidak ada kode undangan → tidak ada yang bisa
mendaftar. Mustahil membuat admin pertama dari UI. README menyebut
`admin1/admin123` yang sebenarnya tidak ada di database mana pun.

**Sesudah:**
- `GET /api/auth/register` mengembalikan `{ bootstrap: true }` kalau belum ada user.
- Form Daftar menampilkan banner: *"Instalasi baru terdeteksi — akun pertama
  otomatis menjadi admin dan tidak perlu kode undangan"*, dan kolom kode
  undangan disembunyikan.
- `POST /api/auth/register` membuat user pertama dengan role `ADMIN`.
- Di instalasi yang sudah ada user, kolom kode undangan tetap muncul dengan
  hint "Belum punya kode? Minta ke admin yang mengundangmu."

Terverifikasi dengan database kosong (0 user, 0 invite code): daftar user pertama
berhasil dan tersimpan sebagai `ADMIN`.

## 3. Pesan error pendaftaran tidak lagi menyembunyikan penyebabnya

**Sebelum:** semua kegagalan jadi "Registrasi gagal. Silakan coba lagi." — termasuk
"kode undangan tidak valid" dan "username sudah dipakai".

**Sesudah:** pesan asli dari server ditampilkan.

## 4. Bahasa & label konsisten

| Sebelum | Sesudah |
|---|---|
| Tab `CD` | `Cooldown` |
| Tab `Done` | `Selesai` |
| `Campaign` (di monitor) | `Project` (sama dengan sisa UI) |
| Status bar: `Siap: 5 \| CD: 4 \| Done: 0` | `Siap: 5 \| Cooldown: 4 \| Selesai: 0` |

Halaman Bantuan ikut diperbarui, plus tips baru soal Undo.

## 5. Navigasi tidak lagi menipu

**Sebelum:**
- Tombol "Dashboard" adalah **toggle**: klik sekali lagi malah pindah ke tree view.
- Tombol **D** di keyboard membuka **Monitor**, berlawanan dengan label toolbar
  dan halaman Bantuan.
- Ada tombol "Semua Task" & "Dashboard" yang ternyata menampilkan layar nyaris
  identik — dua tombol untuk satu hal.

**Sesudah:**
- Toolbar = dua pilihan jelas: **Dashboard** dan **Monitor** (radio, bukan toggle,
  ditandai `aria-pressed`). Tree view tetap tersedia via menu **Lihat → Semua Task**.
- Shortcut **D = Dashboard**, **M = Monitor** (M sebelumnya tidak ada), sesuai
  label di toolbar, tooltip, halaman Bantuan, dan panel Pengaturan.

## 6. Monitor tidak lagi terlihat rusak

**Sebelum:** "Progress Per Campaign" menampilkan **0%** untuk semua project karena
hanya menghitung task berstatus selesai — padahal pada aplikasi task harian,
task memang tidak pernah "tuntas". Bar kosong semua = dikira bug.

**Sesudah:** menjadi **"Status Per Project"** dengan bar bertingkat (siap /
cooldown / selesai) dan teks `2 siap · 1 cooldown · 0 selesai`, plus label kanan
`2 siap` atau `semua jeda`. Legenda progress keseluruhan juga diperbaiki agar
urutannya cocok dengan bar dan tidak memakai singkatan.

## 7. Toolbar mobile tidak lagi deretan ikon misterius

**Sebelum:** di layar ≤400px semua label disembunyikan (`display: none`), menyisakan
7 ikon tanpa keterangan — 📁 📊 📌 🔄 📋 📱 tidak bisa ditebak.

**Sesudah:** label tetap tampil (font 10px, tinggi tombol 30px), toolbar boleh
wrap ke baris kedua. Tidak ada overflow horizontal (diuji 360 / 390 / 768 px).

## 8. Kontras teks dinaikkan

| Elemen | Sebelum | Sesudah |
|---|---|---|
| Meta task, label statistik | `#808080` di `#c0c0c0` ≈ **3.4:1** | `#4a4a4a` ≈ **7:1** |
| Countdown cooldown | `#808000` ≈ **2.4:1** | `#4f4f00` |
| Ukuran meta text | 9px | 11px (12px di desktop) |

Dibuat lewat variabel `--win95-muted` agar mudah disetel ulang tanpa mengubah
nuansa Win95.

## 9. Layout memanfaatkan layar besar

`max-width` desktop 1100px → `min(1400px, 100%)`, jadi di layar 1440px tidak lagi
menyisakan bidang teal kosong sepertiga layar.

## 10. Pesan kosong yang kontekstual

**Sebelum:** semua kondisi kosong menulis "Tidak ditemukan", termasuk saat filter
status tidak punya isi — bikin user mengira datanya hilang.

**Sesudah:** menyesuaikan konteks:
- ada pencarian → `Tidak ada task yang cocok dengan "…"`
- filter siap → `Tidak ada task yang siap dikerjakan sekarang`
- filter cooldown → `Tidak ada task yang sedang cooldown`
- filter selesai → `Belum ada task yang selesai`

---

## Catatan jujur

- **Konten bantuan masih panjang** (satu dialog berisi semua topik). Sudah informatif,
  tapi belum "onboarding bertahap". Untuk user baru, banner instalasi baru +
  Undo + label yang jelas sudah menutup celah terbesar.
- **`src/app/page.tsx` masih 4.0xx baris.** Perbaikan di atas sengaja dilakukan
  secara bedah (tanpa refactor struktur) supaya risiko regresi kecil. Pemecahan
  file tetap pekerjaan terpisah yang layak dikerjakan.
- **Belum ada test otomatis.** Semua verifikasi di sini manual + screenshot.
  Kandidat test pertama: `src/lib/schedule.ts` (logika cooldown & timezone).
- **Verifikasi build:** `npx next build` sukses, `npx tsc --noEmit` bersih.
  Lint masih menyisakan 30 error `react-hooks/*` yang **sudah ada sebelumnya**
  (28 sebelum perubahan) — pola ref di file monolit, bukan dari perubahan ini.
