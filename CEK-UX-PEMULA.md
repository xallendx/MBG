# Apakah UX/UI-nya ramah untuk pengguna pertama kali?

**Jawaban singkat: ya untuk langkah pertama, belum untuk pemakaian harian di HP.**

Aku tidak menebak. Aku **membuat akun baru yang benar-benar kosong** lewat layar Daftar
(pakai kode undangan), lalu menelusuri alurnya seperti orang yang belum pernah melihat app ini —
di desktop 1440×900 dan HP 390×844. Akun uji sudah dihapus setelah selesai; tinggal `admin1`.

---

## 1. Yang sudah bagus (dan ini bukan basa-basi)

### Layar akun kosong benar-benar bersih

Begitu masuk, tidak ada sidebar, tidak ada filter, tidak ada tab, tidak ada kolom kosong.
Yang terlihat hanya:

> 📋 **Mulai dengan tugas pertama**  → `+ Tambah tugas`

**Satu layar, satu aksi.** Ini keputusan desain yang tepat dan sering gagal dilakukan aplikasi lain.
Toolbar atas pun cuma 4 item, bukan 8.

### Form tugas pertama tidak menakutkan

Cuma **3 hal di permukaan**: nama tugas, kapan dikerjakan, link (opsional).
Sisanya (proyek, prioritas, deskripsi, template) dilipat ke **Pengaturan tambahan**.

Labelnya memakai bahasa manusia, bukan istilah teknis:

| Bukan ini | Tapi ini |
|---|---|
| "Nama task" | **"Apa yang ingin dikerjakan?"** |
| "Tipe jadwal" | **"Kapan tugas ini dikerjakan?"** |
| "Daily" | **"Setiap hari pada jam yang dipilih"** |
| "Cooldown" | **"Menunggu"** |

Dan tiap pilihan jadwal punya penjelasan langsung di bawahnya. Pilih "Setiap hari" →
muncul kolom jam + contoh *"00:00 (12:00 AM) berarti siap setiap hari mulai tengah malam"*,
plus info zona waktu.Kolom yang tidak relevan tidak ditampilkan. Ini bagus.

### Aku berhasil membuat tugas pertama tanpa baca panduan

Isi nama → pilih "Setiap hari" → simpan. Berhasil. Lalu klik **Selesai** →
tugas pindah ke **Menunggu** dengan hitungan `4j 56m` dan jam siapnya, dan muncul toast
`✅ Selesai: Klaim faucet harian` dengan tombol **↩ Undo**.

Umpan baliknya jelas dan bisa dibatalkan. Ini bagian terpenting dari aplikasi ini, dan **kerja benar**.

### Panduan singkat isinya berguna

Bukan daftar shortcut, tapi 3 langkah sesuai alur nyata: tambah tugas → kerjakan yang siap →
lihat kapan siap lagi. Ditutup tombol `+ Buat tugas` supaya bisa langsung praktik.

---

## 2. Yang bikin pengguna baru tersendat

### 🔴 A. Menu File / Lihat / Alat tidak bisa dipakai tanpa mouse

Ini temuan paling konkret. Aku tekan **Tab 18 kali** dari awal dan mencatat semua yang ter-focus:

```
📝 → 👤 → Bantuan → ＋Tugas Baru → 📋Daftar → 📊Monitor → Lainnya
→ Semua(1) → Siap(0) → Menunggu(1) → Selesai(0) → Cari tugas
→ Pilih beberapa → Klaim faucet harian → (keluar dokumen)
```

**File, Lihat, dan Alat tidak pernah ter-focus.** Penyebabnya: item menu itu `<div>`, bukan `<button>`:

```
ITEM MENU "Alat": { tag: "DIV", tabIndex: -1, role: null }
```

Di seluruh `page.tsx` ada **26 item menu** (`win95-menubar-item` / `win95-dropdown-item`) dan
**nol** yang punya `role`, `tabIndex`, atau `aria-`.

**Efeknya:** pengguna keyboard dan pembaca layar tidak bisa membuka menu aplikasi sama sekali.
Untungnya **Pengaturan** masih punya jalan lain lewat ikon 👤, jadi tidak buntu total —
tapi tetap saja menu utama itu mati untuk sebagian pengguna.

### 🔴 B. Semua target sentuh di HP di bawah ukuran minimum

Aku ukur **35 tombol** yang terlihat di layar HP. **35-tiganya di bawah 44×44 px**
(rekomendasi minimum WCAG 2.5.5 / Apple / Google):

| Tombol | Ukuran nyata |
|---|---|
| 📝 Catatan | **26 × 24 px** |
| 👤 Profil | **26 × 24 px** |
| ＋ Tugas Baru | 94 × **30 px** |
| ✓ Selesai (di baris tugas) | 330 × **36 px** |
| Tab filter | 83 × **40 px** |

Tombol **Selesai** sudah lebar (330 px) jadi mudah dijangkau jempol — tapi tingginya cuma 36 px.
Dua ikon di pojok (26×24) paling parah: kecil, berdekatan, dan mudah salah tekan.

Ini efek langsung tema Win95 yang memang rapat. Bisa diperbaiki tanpa meninggalkan tema:
tambah area sentuh (padding) di HP sambil menjaga tampilan tetap kotak-kotak.

### 🟠 C. Teks kecil dan kontras kurang — masih ada sisa

Aku hitung rasio kontras dari **warna yang benar-benar ter-render** di browser.
Dari 28 grup teks, **4 gagal WCAG AA** (setelah aku buang 1 salah ukur):

| Teks | Ukuran | Rasio | Butuh |
|---|---|---|---|
| "Siap sekarang" (hijau) | 12 px | **4.19** | 4.5 |
| "Klik tugas untuk melihat detail" | 10 px | **3.79** | 4.5 |
| "⏳ Menunggu (4)" | 11 px | **3.24** | 4.5 |
| "✅ Siap dikerjakan (7)" | 11 px | **2.95** | 4.5 |

Plus **15 grup teks berukuran di bawah 12 px** (judul grup 11 px, hint 10 px, label "PROYEK" 10 px).

Yang paling ironis: **"Siap sekarang"** — status paling penting, yang dicari pengguna setiap buka app —
justru gagal kontras. Hijau `#008000` di atas abu terang kurang gelap. Cukup diganti `#006400`
dan langsung lolos, tanpa mengubah rasa temanya.

> Koreksi jujur: pengukuran pertamaku juga menandai judul titlebar gagal (1.82).
> Itu **salah ukur** — skripku mengambil warna latar padat, padahal titlebar pakai gradien.
> Angka sebenarnya: putih di atas `#000080` = **16.01** (lolos jauh). Jadi titlebar aman.

### 🟠 D. Tombol simpan mati tanpa penjelasan

Kalau nama tugas kosong, tombol "Tambah tugas" **disabled** — benar secara logika.
Tapi tidak ada pesan kenapa. Pengguna baru melihat tombol abu-abu dan tidak tahu apa yang kurang.
Aku cek: tidak ada `title` maupun `aria-describedby` di tombol itu.

Padahal kode validasinya sudah punya pesannya (`'Nama tugas wajib diisi.'` di `page.tsx:1308`) —
tidak pernah tampil karena tombolnya keburu disabled. Cukup tampilkan pesan itu sebagai hint.

### 🟡 E. Dua ikon tanpa nama yang terbaca mesin

```
📝  aria-label: null   (title: "Catatan (Notepad)")
👤  aria-label: null   (title: "Profil Akun")
```

`title` baru muncul saat hover — **tidak ada hover di HP**. Jadi di ponsel, dua tombol ini
hanya emoji tanpa keterangan. Pembaca layar juga tidak membacakan namanya.
Ironisnya tombol ✕ notifikasi sudah punya `aria-label` yang benar — tinggal samakan.

### 🟡 F. Pengaturan notifikasi tersembunyi cukup dalam

Untuk menyalakan pengingat — alasan utama orang memakai app ini — jalurnya:
**ikon 👤 → Pengaturan → cari bagian notifikasi**. Tidak ada satu pun petunjuk di layar utama
yang mengarahkan ke sana setelah tugas pertama dibuat.

Digabung dengan bug Web Push yang kulaporkan sebelumnya (`HASIL-CEK.md` bagian A),
pengguna baru kemungkinan besar **tidak pernah mendapat notifikasi apa pun**:
jalurnya tersembunyi, dan kalaupun ditemukan, service worker-nya gagal install.

---

## 3. Kesimpulan

**Untuk 5 menit pertama: ramah.** Empty state satu aksi, form bertahap dengan bahasa manusia,
umpan balik Selesai/Undo yang jelas, panduan singkat yang relevan. Aku bisa membuat dan
menyelesaikan tugas pertama tanpa bantuan. Keputusan desain di `docs/ux/PANDUAN-PENGGUNA-BARU.md`
benar-benar diterapkan, bukan cuma ditulis.

**Untuk pemakaian harian: belum nyaman,** terutama di HP — semua target sentuh kekecilan,
teks penting gagal kontras, dan menu aplikasi tidak bisa diakses lewat keyboard.

Kabar baiknya: **tidak ada yang perlu dibongkar.** Struktur informasinya sudah benar.
Semua temuan di atas perbaikan kecil dan terukur.

### Urutan yang aku sarankan

| # | Perbaikan | Effort | Dampak |
|---|---|---|---|
| 1 | Bug Web Push (`HASIL-CEK.md` A) | kecil | Fitur inti jadi hidup |
| 2 | Area sentuh ≥44 px di HP | kecil | Langsung terasa tiap hari |
| 3 | Hijau `#008000` → `#006400`, teks 10→12 px | kecil | Status utama jadi terbaca |
| 4 | `aria-label` untuk 📝 dan 👤 | sangat kecil | HP & pembaca layar |
| 5 | Menu `<div>` → `<button>` + `role` | sedang | Akses keyboard |
| 6 | Pesan kenapa tombol simpan mati | sangat kecil | Hilangkan bingung |
| 7 | Arahkan ke Pengaturan notifikasi setelah tugas pertama | kecil | Pengguna dapat pengingat |

**Batasan uji:** ini pengujian browser otomatis, bukan uji kegunaan dengan manusia.
Aku bisa membuktikan tombol terlalu kecil dan kontras gagal AA, tapi **tidak bisa membuktikan**
orang sungguhan bingung atau tidak — itu butuh 3–5 pengguna baru yang belum kenal app ini.
