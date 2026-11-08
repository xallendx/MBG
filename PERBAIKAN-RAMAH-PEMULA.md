# Perbaikan: nyaman dipakai harian, mudah untuk yang baru join

Semua temuan di `CEK-UX-PEMULA.md` dan bug Web Push di `HASIL-CEK.md` sudah dikerjakan
dan **diverifikasi ulang lewat browser**, bukan sekadar diubah kodenya.

Tema Win95 **tidak diubah**. Yang diperbaiki: ukuran target sentuh, kontras, akses
keyboard, dan petunjuk yang tadinya hilang.

---

## Hasil sebelum → sesudah (diukur, bukan dikira)

| Yang diukur | Sebelum | Sesudah |
|---|---|---|
| Tombol di HP di bawah 44 px | **35 dari 35** | **0 dari 40** ✅ |
| Ikon pojok 📝 / 👤 | 26 × 24 px | **44 × 44 px** |
| Tombol ✓ Selesai di baris tugas | 330 × 36 px | **324 × 48 px** |
| Kontras "Siap sekarang" | 4.19 ❌ | **6.07** ✅ |
| Kontras "✅ Siap dikerjakan" | 2.95 ❌ | **9.48** ✅ |
| Kontras "⏳ Menunggu" | 3.24 ❌ | **9.48** ✅ |
| Menu File/Lihat/Alat lewat Tab | tidak tercapai ❌ | **tercapai & bisa dibuka Enter** ✅ |
| Service worker (Web Push) | `redundant`, 0 registrasi ❌ | **`activated`, 1 registrasi** ✅ |
| Alasan tombol simpan mati | tidak ada | **"Isi dulu nama tugas di atas…"** ✅ |
| Jalan ke pengingat dari layar utama | tidak ada | **ajakan "Nyalakan pengingat"** ✅ |

Verifikasi lain: `tsc` bersih · **117 test lolos** · **build produksi sukses** ·
lint **tetap 30** (tidak menambah masalah baru) · complete→undo masih benar (7→6→7) ·
tidak ada `pageerror` di browser.

---

## 1. Web Push hidup kembali (`public/sw.js`, `src/app/page.tsx`)

**Masalah:** `cache.addAll(['/', '/favicon.ico'])` — file favicon tidak ada (404).
`addAll` bersifat atomik, jadi seluruh install gagal dan service worker dibuang.
`navigator.serviceWorker.ready` lalu menggantung selamanya tanpa pesan.

**Perbaikan:**
- Precache pakai `Promise.all` + `cache.add(...).catch(...)` per aset → satu aset gagal
  tidak lagi mematikan push
- Semua rujukan `/favicon.ico` → `/logo.svg` (aset yang benar-benar ada)
- `CACHE_NAME` naik ke `mbg-v4` supaya cache lama dibuang
- `serviceWorker.ready` diberi batas 10 detik; kalau gagal, ada peringatan jelas dan
  alur berhenti rapi alih-alih menggantung

**Bukti:** uji browser sekarang `{ finalState: "activated", registrations: 1, active: true }`.

## 2. Target sentuh ≥ 44 px (`globals.css`)

Pakai `@media (pointer: coarse)` — menyasar **perangkat sentuh**, bukan sekadar layar
sempit. Jadi desktop ber-mouse tetap rapat seperti Win95 asli (terverifikasi: tombol
toolbar desktop masih 20–24 px).

- Semua tombol utama, tab, chip proyek, item menu: `min-height: 44px`
- Aksi di baris tugas (paling sering ditekan): **48 px**
- Ikon pojok: 26×24 → **44×44**, titlebar ikut menyesuaikan
- Kotak centang massal: 14 → **22 px**
- Jarak antar tombol diperlebar supaya jempol tidak menekan dua sekaligus

**Nama tugas** juga jadi target sentuh penuh, dengan `min-width: 0` supaya nama panjang
dipotong ellipsis — bukan mendorong kolom status keluar baris. Di HP, status pindah ke
baris sendiri sehingga nama tugas punya ruang penuh. Pita warna status dibuat absolut
agar tetap setinggi kartu walau isinya membungkus.

## 3. Kontras & ukuran teks (`globals.css`, `page.tsx`)

- `--win95-siap`: `#008000` → **`#006400`** (4.19 → 6.07)
- Judul grup tidak lagi memakai teks berwarna kontras rendah; sekarang teks gelap
  **9.48** dengan **pita warna di kiri** sebagai penanda status. Arti warna tetap sama
- Teks yang tadinya 9–11 px dinaikkan ke 11–13 px; di HP nama tugas jadi 14 px

## 4. Menu aplikasi bisa dipakai keyboard (`page.tsx`, `globals.css`)

**Masalah:** 26 item menu berupa `<div>` tanpa `role`/`tabIndex` → Tab tidak pernah mencapainya.

**Perbaikan:**
- File/Lihat/Alat → `<button>` dengan `aria-haspopup` + `aria-expanded`
- 18 item dropdown → `<button role="menuitem">`, wadah jadi `role="menu"`
- Item info (nama user, role) ditandai `win95-dropdown-info` supaya tidak diberi hover palsu
- Gaya bawaan tombol dinetralkan → **tampilan tetap sama**
- Fokus terlihat jelas di semua kontrol

**Bukti urutan Tab sekarang:** `📝 → 👤 → File → Lihat → Alat → Bantuan → …`
Enter pada "Alat" membuka menu berisi Telegram, Pengaturan, Template Task.

## 5. Tombol simpan menjelaskan kenapa ia mati (`page.tsx`)

Dulu disabled tanpa keterangan. Sekarang muncul **"Isi dulu nama tugas di atas untuk
melanjutkan."** tepat di atas tombol, plus `aria-describedby` dan `title`.
Begitu nama diisi, petunjuknya hilang sendiri.

## 6. Ajakan menyalakan pengingat (`page.tsx`, `globals.css`)

Kotak biru muncul di daftar setelah pengguna punya tugas **dan** belum punya pengingat
aktif (Telegram maupun push):

> **Biar tidak lupa mengerjakan**
> Nyalakan pengingat supaya kamu dikabari saat tugas siap lagi — termasuk ketika aplikasi ditutup.
> [Nyalakan pengingat] [Nanti saja]

- "Nyalakan pengingat" membuka Pengaturan langsung
- "Nanti saja" menyimpan pilihan **per akun** di localStorage → tidak muncul lagi,
  dan tidak tertimpa di perangkat bersama
- Hilang otomatis begitu pengingat benar-benar aktif
- Tidak muncul di akun kosong (belum ada tugas) supaya tidak mengganggu langkah pertama

## 7. Nama tombol terbaca mesin & preferensi sistem

- 📝 → `aria-label="Catatan"`; 👤 → `aria-label="Profil dan pengaturan akun"` +
  `aria-haspopup`/`aria-expanded`. Sebelumnya hanya `title`, yang **tidak muncul di HP**
- `prefers-reduced-motion` dihormati

---

## Cara kerja yang kujaga

- **Tidak menambah error lint.** Sempat naik 1 karena effect baru; kupindahkan ke lazy
  initializer + `persistAuth` (pola yang sudah dipakai `authUser`) → kembali ke 30
- **Tidak mengubah tema.** Semua perubahan bentuk berlaku di perangkat sentuh saja
- **Tidak menyentuh logika bisnis.** Jadwal, cooldown, undo, API: tidak diubah
- Akun uji (`userbaru1`, `pemula2`) dan kode undangannya **sudah dihapus**; tinggal `admin1`

## Yang belum dikerjakan (sengaja)

| Item | Alasan |
|---|---|
| 30 error lint lama (`react-hooks/*` di `page.tsx`) | Sudah ada sebelum perubahan ini; butuh refactor terpisah. Aku tidak menambah yang baru |
| Lint masuk CI | Sebaiknya setelah 30 error lama beres, supaya CI tidak langsung merah |
| Tree View mati, README usang, dependency tak terpakai | Temuan `HASIL-CEK.md` C/D/E — di luar lingkup UX pemula |

## Batasan

Ini verifikasi browser otomatis: aku bisa membuktikan ukuran, rasio kontras, jangkauan
keyboard, dan service worker aktif. Aku **belum** bisa membuktikan orang sungguhan merasa
lebih mudah — itu tetap butuh uji dengan 3–5 pengguna baru.

**Cara coba sendiri:** buka live preview, login `admin1` / `admin123` (akun demo sandbox, bukan akun produksi), lalu buka dari HP
(atau DevTools mode ponsel) untuk merasakan tombol yang sudah lega.
