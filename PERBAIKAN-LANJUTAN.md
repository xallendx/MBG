# Perbaikan lanjutan: sisa temuan ditutup

Melanjutkan `AUDIT-PR-1.md`. Yang dikerjakan di sini adalah item yang sebelumnya
sengaja ditunda: layar pendek/kecil, CI yang tidak menjalankan lint, Tree View mati,
dan README yang salah.

---

## 1. Layar pendek dan HP kecil — penyebabnya bukan yang saya kira

Sebelumnya saya menduga masalahnya "terlalu banyak hiasan". Setelah diukur per elemen,
penyebab sebenarnya tiga hal yang tidak terpikirkan:

**a. Baris "Pilih beberapa" memakan 51px hanya untuk satu tombol.**
Di semua ukuran HP ada satu baris tersendiri berisi petunjuk + satu tombol.
Tombolnya dipindah ke samping kolom cari; barisnya dihapus. Petunjuknya tidak hilang —
teks yang sama sudah ada di `.v3-hint` di bawah daftar.

**b. `gap: 8px` pada baris tugas ikut berlaku antar baris yang membungkus.**
Baris tugas memakai `flex-wrap`. Karena nama, status, dan tombol masing-masing satu
baris penuh, ada 2 celah × 8px = **16px terbuang per tugas** untuk jarak yang tidak
terlihat perlu. Dikecilkan jadi 1px.

**c. Kolom cari hanya 26px — dan audit saya sebelumnya tidak melihatnya.**
Semua audit target sentuh saya cuma mengukur `<button>`, tidak `<input>`. Kolom cari
ternyata 26px. Sekarang 44px, dan **tidak menambah tinggi baris** karena tombol di
sebelahnya sudah 44px.

### Hasil (perangkat sentuh)

| Layar | Daftar sebelum | Sesudah | Tugas terlihat |
|---|---|---|---|
| 320×568 (HP kecil) | 214px | **247px** | 1 → **2** |
| 390×844 (HP biasa) | 490px | **523px** | 3 → **4** |
| 844×390 (landscape) | 80px → 118px | **200px** | 1 → **3** |
| 768×1024 (tablet) | 694px | **727px** | 9 → **11** |

Dibanding titik awal seluruh pekerjaan: di HP biasa, daftar naik **387px → 523px**
dan tugas terlihat **2 → 4**. Tinggi satu baris turun **163px → 108px**.

**Target sentuh tetap 0 yang di bawah 44px** di keempat ukuran — sekarang menghitung
`input`, `select`, `textarea`, dan `summary`, bukan hanya `button`.

Diuji fungsinya, bukan cuma ukurannya:
```
tombol pilih: 44×44, aria-label "Pilih beberapa tugas"
mode pilih aktif: true
"Pilih semua yang terlihat" -> 11 dipilih
"Batal memilih" -> kembali normal: true
cari "faucet" -> hasil: Claim faucet harian
ERRORS: []
```

Desktop tidak berubah: toolbar tetap 20–24px, menubar tetap ada, complete→undo 7→6→7.

---

## 2. CI tidak pernah menjalankan lint

Ini temuan lama yang paling berbahaya secara diam-diam: 30 error `react-hooks/*` sudah
ada, dan **tidak ada yang mencegah jumlahnya bertambah** karena CI hanya menjalankan
tsc, test, dan build.

Memperbaiki 30 error itu berarti membongkar pola ref/state di satu komponen besar —
risiko regresinya lebih besar daripada manfaatnya, jadi tidak dikerjakan sekalian.
Yang dikerjakan: **mengunci jumlahnya.**

- `scripts/lint-baseline.mjs` membandingkan hasil lint dengan `eslint-baseline.json`
- error baru (aturan baru atau jumlah naik) → **CI gagal**, dengan lokasi barisnya
- jumlah turun → lulus, dan diminta mengunci perbaikan lewat `--update`
- langkah baru di `.github/workflows/ci.yml`: `npm run lint:baseline`

**Penjaganya diuji dengan sengaja menanam error baru:**
```
tanam file berisi setState di dalam effect
  -> exit 1, "react-hooks/set-state-in-effect: 3 error (baseline 2) — lebih 1"
     menunjuk src/app/__lint_probe.tsx:5
hapus file itu
  -> exit 0, "Tidak ada utang baru"
```

Warning juga dibersihkan: ada satu `eslint-disable` yang tidak terpakai. Sekarang
**30 error, 0 warning** (sebelumnya 30 error + 1 warning).

---

## 3. Tree View mati — dihapus, bukan dibiarkan menyesatkan

`viewMode` punya nilai `'tree'` di union-nya, tapi:
- tidak ada satu pun kode yang meng-set `'tree'`
- cabang render hanya `monitor` vs `dashboard`
- `renderFolder` (**96 baris**) tidak pernah dipanggil

Jadi fitur itu tidak bisa dicapai pengguna dengan cara apa pun. Union dan fungsi matinya
dihapus. Kalau suatu saat memang ingin tampilan pohon, itu fitur baru yang perlu
dirancang — bukan menghidupkan kode yang tidak pernah teruji.

---

## 4. README bertentangan dengan dirinya sendiri

| Baris | Sebelumnya | Sesudah |
|---|---|---|
| Tech Stack | "Tailwind CSS 4 + Windows 95 custom theme" | "CSS biasa (`globals.css`) dengan tema Windows 95 — tanpa Tailwind" |
| Struktur kode | "perhitungan cooldown & jadwal (**13 test**)" | "inti suite vitest: **117 test di 9 file**" |

Soal Tailwind, README bahkan membantah dirinya sendiri: baris 25 bilang memakai Tailwind,
baris 162 bilang **tidak** memakai Tailwind. Dicek ke `package.json` dan tidak ada
`tailwind` sama sekali — baris 162 yang benar.

---

## Yang juga diperbarui

`TAMPILAN-SEKARANG.html` diambil ulang dari aplikasi yang sudah diperbaiki, jadi angka
dan tampilannya tidak tertinggal. Panelnya sekarang memuat tabel empat ukuran layar.
Diuji ulang lewat `file://`: **0 permintaan jaringan keluar, 0 error**, alur klik jalan.

---

## Gerbang mutu

- `tsc --noEmit` **bersih**
- **117 test lolos** (9 file)
- `next build` **exit 0**
- `npm run lint:baseline` **exit 0** — 30 error (terkunci), **0 warning**
- Target sentuh **0 di bawah 44px** di 320/390/844/768, termasuk `input`
- Desktop tetap rapat; complete→undo benar
- Tidak ada error browser; data demo tetap 7 siap / 4 menunggu, hanya `admin1`

## Yang masih terbuka (jujur)

- **30 error lint lama masih ada** — sekarang terkunci dan tidak bisa bertambah, tapi
  belum dibereskan. Membereskannya perlu refactor komponen besar dengan uji terpisah.
- **Safari/iOS dan Firefox belum diuji.** Semua pengukuran di Chromium headless.
- Landscape sudah lebih baik (3 tugas, bukan 1) tapi tetap layar yang sempit.
- Rasa "mudah dipakai" tetap butuh uji dengan pengguna sungguhan, bukan angka.
