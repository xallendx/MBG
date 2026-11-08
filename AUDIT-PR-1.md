# Audit mendalam sebelum merge

Audit atas PR #1 (`arena/9edcaf16-mbg` → `main`), termasuk mencari kesalahan pada
perubahan yang saya buat sendiri. **Enam masalah ditemukan, semuanya sudah diperbaiki
dan diuji ulang.** Dua di antaranya cukup serius untuk menahan merge.

---

## Ringkasan temuan

| # | Temuan | Sumber | Berat | Status |
|---|---|---|---|---|
| 1 | Export Backup, Import Data, Import Share Code **hilang total dari HP** | perubahan saya (putaran 3) | 🔴 serius | diperbaiki |
| 2 | Menu "Lainnya" keluar layar di HP landscape → item Import tak terjangkau | perubahan saya (audit ini) | 🔴 serius | diperbaiki |
| 3 | Dialog Pengingat bisa berkata "browser belum mendukung" di Chrome | perubahan saya (putaran 2) | 🟠 sedang | diperbaiki |
| 4 | Preferensi notifikasi disimpan **sebelum** izin diberikan | perubahan saya (putaran 2) | 🟠 sedang | diperbaiki |
| 5 | Tombol "+ Proyek baru" 28px di tablet | lama, terlewat audit | 🟡 ringan | diperbaiki |
| 6 | `/api/push/vapid-key` membalas **500** hanya karena belum dikonfigurasi | lama | 🟡 ringan | diperbaiki |

Plus: klaim salah di komentar CSS dan laporan sudah dikoreksi, dan state bar
konfirmasi sekarang dibersihkan saat logout.

---

## 1 🔴 Fitur penyelamat data hilang dari HP

Putaran 3 menyembunyikan `.win95-menubar` di layar sentuh untuk menambah ruang daftar.
Saya mengira semua aksinya punya padanan di toolbar. **Ternyata tidak.**

Diukur dengan membuka setiap submenu lalu membandingkan dengan semua yang benar-benar
bisa ditekan di HP (layar utama + menu profil + Lainnya):

```
HILANG | Export Backup      -> []
HILANG | Import Data        -> []
HILANG | Import Share Code  -> []
```

Ini serius: `docs/DEPLOY-VERCEL.md` di repo ini menekankan backup sebelum deploy, dan
justru jalur backup-nya yang saya putus di HP.

**Perbaikan:** ketiganya ditambahkan ke menu "Lainnya" (yang tetap tampil di HP),
dipisah garis dari aksi tampilan. Diuji bukan cuma ada, tapi **berfungsi**:

```
Export dari HP -> mbg-backup-2026-11-08.json
isi valid JSON, task: 11
```

**Komentar CSS saya sebelumnya salah** — tertulis "tetap bisa dijangkau keyboard/screen
reader". Diukur: `menubar terjangkau keyboard di HP: false`. `display:none` memang
menghapus dari tab order dan accessibility tree. Komentar sudah diganti dengan
peringatan yang benar: setiap item menubar baru **wajib** punya padanan di
toolbar/Lainnya/menu profil.

## 2 🔴 Menu "Lainnya" keluar layar setelah diperbaiki

Akibat menambah 3 item, menu jadi **372px**. Di HP landscape (tinggi 390px) menu mulai
dari y=108, jadi berakhir di 480 — **melewati layar**. Item Import yang baru saya
tambahkan justru tidak bisa ditekan.

**Perbaikan:** `max-height: min(70vh, 420px)` + `overflow-y: auto`.

Diuji di 844×390:
```
menuTinggi: 273 | bisaGulir: true
itemTerakhir: "🔗 Import share code"
setelahGulir_diDalamLayar: true | tinggiItem: 44
```

## 3 🟠 Dialog bisa memfitnah browser sendiri

`pushStatus` memakai `pushSupported`, yang **baru bernilai true setelah pendaftaran
berjalan**. Akibatnya ada dua keadaan salah lapor:

- saat dialog baru dibuka → sempat "Browser ini belum mendukung" padahal Chrome mendukung
- saat service worker gagal aktif → "Browser ini belum mendukung", padahal penyebabnya lain

Ini persis jenis pesan menyesatkan yang dialog ini dibuat untuk menghapus.

**Perbaikan:** kemampuan browser ditentukan dari feature detection (`serviceWorker` +
`PushManager`), dan kegagalan penyiapan jadi status sendiri (`setup-failed`) dengan
pesan "Notifikasi gagal disiapkan di perangkat ini. Coba muat ulang halaman."
Izin juga disegarkan setiap dialog dibuka, karena bisa berubah lewat setelan browser.

## 4 🟠 Preferensi disimpan sebelum izin

`enablePushReminder` dulu menyimpan `browserNotifEnabled: true` ke server **sebelum**
meminta izin. Kalau pengguna menolak, server tetap mencatat notifikasi aktif — kembali
ke keadaan menyesatkan yang ingin dihapus.

**Perbaikan:** izin dulu; preferensi hanya disimpan kalau benar-benar `granted`.

Selain itu, kalau server belum punya VAPID key, dialog sekarang **tidak menawarkan
tombol izin sama sekali**. Diuji dengan izin `default`:

```
isi: "Server belum dikonfigurasi untuk push... Pakai Telegram di bawah — itu tetap jalan"
tombol: []            <- tidak ada tombol yang menjanjikan sesuatu mustahil
reqCalled: 0          <- izin browser tidak pernah diminta
```

**Keempat keadaan push diuji terpisah, semuanya jujur:**

| Keadaan | Yang ditampilkan |
|---|---|
| Server belum dikonfigurasi | pakai Telegram; tanpa tombol izin |
| Izin diblokir browser | cara membuka blokir lewat ikon gembok |
| Penyiapan gagal | coba muat ulang; atau Telegram |
| Server siap + izin beres | badge **Aktif**, "✅ Sudah aktif" |

## 5 🟡 Tombol 28px yang terlewat

Audit sebelumnya hanya di 390×844, tempat sidebar disembunyikan. Diukur ulang di layar
lebar bersentuhan: `+ Proyek baru` ternyata **28px** (`.v3-side-add`).

**Perbaikan:** 44px di perangkat sentuh. Hasil: **0 target di bawah 44px** di semua
ukuran yang diuji.

Sekalian ditemukan layar pendek sangat sempit untuk daftar. Diperbaiki tanpa
mengecilkan tombol:

| Layar | Daftar sebelum | Sesudah |
|---|---|---|
| 844×390 (HP landscape) | 80px | **118px** |
| 320×568 (HP kecil) | 214px | 214px |
| 1024×768 (tablet) | 475px | 475px |

## 6 🟡 500 untuk sekadar belum dikonfigurasi

`/api/push/vapid-key` membalas **500 `Push not configured`** setiap kunjungan kalau
VAPID key belum diisi. Di Vercel itu tercatat sebagai error server padahal aplikasinya
sehat — mengganggu saat memantau deploy.

**Perbaikan:** balas **200** dengan `{ publicKey, configured }`. Klien jadi bisa
membedakan "belum dikonfigurasi" dari "jaringan gagal", dan tidak ada 5xx palsu di log.
Ini juga yang memungkinkan temuan #4 diperbaiki.

---

## Yang diperiksa dan ternyata aman

| Item | Hasil |
|---|---|
| Service worker menyajikan HTML basi setelah deploy | **aman** — network-first, cache hanya cadangan offline |
| Data pengguna masuk cache SW | **aman** — `/api/*` dikecualikan; data tidak ada di HTML |
| Cache lama tidak dibersihkan | **aman** — `activate` menghapus semua kecuali `mbg-v4` |
| Hydration mismatch (state dari localStorage) | **tidak ada** — `HYDRATION: []` |
| Bar konfirmasi nyangkut antar akun | awalnya kotor, **sudah dibersihkan saat logout** |
| Bar muncul lagi setelah dijawab "Belum" | **tidak** |
| Bar untuk tugas yang sudah tidak siap | **tidak muncul** |
| Export menghasilkan berkas rusak | **tidak** — JSON valid, 11 tugas |
| Overflow horizontal | **tidak ada** di 320/390/768/844/1024 |

Kasus tepi bar konfirmasi, diuji satu per satu:
```
bar muncul setelah kembali: true
setelah "Belum", bar tidak muncul lagi: true
nama di bar cocok tugas terakhir: "Submit tugas bounty"
setelah logout: {bar: false, login: true}
login ulang, bar tidak nyangkut: true
```

---

## Gerbang mutu sesudah audit

- `tsc --noEmit` **bersih**
- **117 test lolos** (9 file)
- `next build` **exit 0**
- eslint **30 error + 1 warning** — persis baseline, tidak menambah utang
- Service worker: **activated, 1 registrasi**
- Target sentuh efektif: **0 di bawah 44px** (390×844, 320×568, 844×390, 768×1024, 1024×768)
- Desktop 1440×900 tetap rapat (20–24px), complete→undo benar (7→6→7)
- Tidak ada error browser; data demo dipulihkan ke 7 siap / 4 menunggu

## Batas audit ini

- Dijalankan di **Chromium headless**. Safari/iOS dan Firefox **belum diuji** — push di
  iOS punya aturan sendiri (harus dipasang ke Home Screen), jadi perilaku nyata di iPhone
  masih perlu dicek manusia.
- Layanan push nyata tidak tersedia di sandbox; jalur positif diuji dengan kunci
  berformat valid dan `subscribe` yang di-stub. Yang terbukti adalah **logika aplikasi**,
  bukan pengiriman notifikasi sungguhan.
- Kepadatan landscape masih ketat (118px ≈ 1 baris). Lebih baik dari 80px, tapi belum
  nyaman — kalau landscape penting untukmu, itu perlu putaran tersendiri.
- **Tidak menyentuh**: 30 error lint lama dan CI yang tidak menjalankan lint, Tree View
  tak terjangkau, README usang. Semua sudah ada sebelum PR ini.
- Audit ini membuktikan ukuran, status, dan jangkauan aksi. Rasa "mudah dipakai" tetap
  butuh uji dengan pengguna sungguhan.

## Kesimpulan

**PR ini layak merge setelah perbaikan di atas** — justru karena audit menemukan dua
masalah serius yang saya buat sendiri dan keduanya sudah ditutup dengan bukti.

Untuk Vercel: tetap **tanpa perubahan schema database**. Perubahan tambahan pada
`/api/push/vapid-key` hanya mengubah kode status respons, bukan kontrak data.
Kalau VAPID key belum diisi, sekarang tidak lagi membanjiri log dengan 500.
