# Review UX — jujur, lalu ditata ulang

Pertanyaanmu: *"apakah UX/UI seperti ini mudah dimengerti dan dikerjakan?"*

Jawaban jujur: **belum.** Tampilannya khas dan menyenangkan, tapi untuk dipakai
tiap hari (terutama di HP, sambil buru-buru mengecek cooldown) versi sebelumnya
membuat user berpikir terlalu banyak. Bukan karena temanya Win95, tapi karena
**struktur informasinya bersarang**.

---

## Apa yang salah (konkret, bukan selera)

| # | Masalah | Kenapa menyulitkan |
|---|---|---|
| 1 | **Empat lapis penyaringan** sebelum melihat task: tab status → dropdown project → folder project (accordion) → grup status di dalam folder | Untuk 11 task saja, mata harus melewati 4 tingkat. Menebak "task ini ada di mana" jadi pekerjaan tersendiri |
| 2 | **Dua tempat untuk hal yang sama**: dropdown "Semua Project" *dan* deretan folder project | Bingung mana yang mengatur tampilan |
| 3 | **Aksi utama paling kecil**: tombol "Selesai" (aksi yang 90% dilakukan user) berukuran paling kecil dan warnanya abu-abu seperti tombol nonaktif | User ragu apakah tombolnya bisa diklik |
| 4 | **Teks 10–11 px** dan abu `#808080` di atas abu `#c0c0c0` | Rasio kontras ~3,4:1 — gagal WCAG AA, susah dibaca di HP/luar ruangan |
| 5 | **Tidak ada label kolom** | Angka "21j 19m" tanpa judul kolom: itu cooldown? umur task? |
| 6 | **Status tersembunyi di dalam nama folder** ("SIAP 1", "COOLDOWN 2") | Status task tidak terlihat saat folder tertutup; harus buka-tutup folder |
| 7 | **Toolbar 8 tombol setara** | Semua aksi terlihat sama penting; tidak ada hierarki |
| 8 | Tombol utama (task baru) ada di tengah-tengah toolbar | Aksi paling sering justru tidak menonjol |

---

## Yang diubah (tema Win95 tetap)

Bukan ganti tema. Yang dirombak adalah **tata letak dan hierarki**, tiga hal:

### 1. Project pindah ke sidebar, penyaringan jadi satu lapis

- Sidebar kiri: **Semua project → tiap project (dengan jumlah task) → + Project baru**, plus ringkasan "Bisa dikerjakan / Cooldown / Selesai".
- Tab status tetap di atas, tapi **folder accordion dan grup status di dalam folder dihapus**. Satu task = satu baris.
- Dropdown project yang duplikat dihapus.

### 2. Baris task ditulis ulang: dua tingkat, aksi jelas

```
▌ ■ Submit tugas bounty                      Siap sekarang   [Kerjakan] [✓ Selesai] 🔗
  │ GenLayer Mainnet   Sekali   · 1× selesai
```

- **Nama task 13 px tebal** (sebelumnya 11 px), meta di bawahnya: project (chip berwarna), tipe jadwal, berapa kali sudah selesai.
- **Kolom status** kini punya judul, isinya bahasa manusia: "Siap sekarang" atau "18j 12m" + jam siapnya.
- **Tombol aksi diberi label** ("Kerjakan", "✓ Selesai", "↺ Reset", "↺ Batal"), bukan ikon kecil.
- Warna status dipakai sebagai pita kiri baris (hijau = siap, kuning = cooldown), jadi status terbaca dari peripheral vision tanpa membaca teks.

### 3. Hierarki toolbar & kontras

- Toolbar: **＋ Task Baru** (hijau, paling kiri) → Project → [Daftar | Monitor] → Refresh/Template/Telegram.
- Teks sekunder `#808080` → `#404040`; ukuran font naik (10–11 px → 12–13 px).
- Shell mengisi tinggi layar, daftar punya area gulir sendiri, dan ada baris hint di bawah daftar: `Klik baris untuk detail · klik kanan untuk menu · F cari · T task baru · R muat ulang`.

### Di HP

Sidebar jadi baris chip yang bisa digeser horizontal, kolom status pindah ke bawah nama, dan tombol aksi memenuhi lebar baris sehingga mudah dijangkau jempol.

| Sebelum | Sesudah |
|---|---|
| ![](sebelum.png) | ![](sesudah.png) |

Monitor tetap ada (statistik), dan tombol aksinya kini memakai gaya yang sama dengan daftar supaya tidak ada lagi "dua bahasa tombol" di satu aplikasi.

![](monitor.png)

---

## Yang TIDAK diubah (sengaja)

- Tema, palet, border 3D, titlebar biru, font Tahoma — identitas produk.
- Semua alur & fitur: dialog tambah/edit, template, Telegram, impor/ekspor, share, catatan, shortcut keyboard.
- Logika data (`getActiveTasks`, pengurutan pinned→prioritas, perhitungan cooldown) tidak disentuh — hanya lapisan tampilan yang berubah.

---

## Verifikasi

```
tsc --noEmit  → bersih
npm test      → 78 passed
next build    → sukses
```

Diuji lewat browser sungguhan (Playwright, desktop 1280×900 & HP 390×844):

- daftar 11 task tampil, filter sidebar → 3 task sesuai project;
- tombol "Selesai" → task hilang dari daftar + toast "Selesai: …" + tombol **Undo** berfungsi;
- klik baris → dialog detail terbuka;
- tidak ada error konsol.

## Yang masih bisa diperbaiki (jujur)

1. **Monitor** masih memakai tata letak lama (kartu statistik besar, daftar kecil) — informasinya banyak tapi tidak ada aksi langsung.
2. **Dialog detail task** belum ditata ulang (masih padat, tombol kecil).
3. **Belum ada cara mengurutkan manual** (drag & drop) di daftar baru; urutan masih pinned → prioritas.
4. **Belum ada aksi massal** (pilih beberapa task → selesaikan sekaligus).
5. `page.tsx` masih ±4.100 baris; tata letak baru ini menambah, bukan mengurangi. Refactor ke komponen terpisah (P1-4) tetap pekerjaan tersendiri.

---

## Pembaruan berikutnya — Monitor, detail dan aksi massal

- Monitor sekarang menggunakan baris dan tombol yang sama dengan daftar; kartu ringkasan dapat diklik untuk membuka filter, dan baris project membuka daftar project tersebut. Bilah status menunjukkan proporsi siap/cooldown/selesai.
- Dialog detail ditata ulang: status di atas, informasi berlabel, catatan dan tombol yang lebih jelas, dengan tata letak responsif.
- Daftar memiliki kotak centang, pilih semua task yang terlihat, serta aksi **Selesaikan** dan **Reset** untuk pilihan. Pilihan yang tersembunyi oleh filter tetap dihitung dan ditandai; pengguna dapat membatalkan pilihan.
- Selesaikan hanya memproses task siap. Reset hanya memproses task yang didukung. Keduanya meminta konfirmasi; reset memperingatkan bahwa **seluruh riwayat penyelesaian akan dihapus dan tidak bisa di-undo**. Hasil sebagian gagal dilaporkan dan yang gagal tetap terpilih. Undo tersedia untuk penyelesaian yang berhasil, termasuk pada hasil parsial.
- Reset per task juga memperingatkan penghapusan seluruh riwayat, dan tombol reset tidak ditampilkan untuk jenis jadwal yang tidak didukung API.

Verifikasi: `tsc --noEmit`, build produksi, 78 tes; browser desktop dan mobile. Uji browser menyelesaikan dua task demo lalu membatalkannya dan memeriksa keduanya kembali siap. Uji hasil parsial dilakukan dengan respons API tiruan, tanpa mengubah data. Pratinjau HTML adalah snapshot statis untuk melihat tata letak; gunakan aplikasi live untuk menjalankan aksi dan menyimpan data.

**Batasan:** aksi massal menggunakan beberapa permintaan individual, bukan transaksi atomik; sebagian task bisa berhasil ketika sebagian lain gagal. Undo juga terdiri dari beberapa permintaan dan hasilnya dilaporkan jika sebagian gagal. Belum ada drag-and-drop pengurutan; `page.tsx` masih perlu dipecah. Catatan kekurangan Monitor/detail/aksi massal pada bagian sebelumnya berlaku untuk versi sebelum pembaruan ini.
