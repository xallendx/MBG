# Akses Admin — pemulihan login tanpa menyentuh SQL

Branch: `arena/cdc3fb13-mbg` · Basis: `main` `4b43b0d`

## Kenapa kamu tidak bisa masuk

Tiga hal bertumpuk, dan tidak satu pun adalah "password salah":

1. **Tidak ada password admin bawaan.** `admin1` / `admin123` yang disebut README
   hanya lahir kalau `npm run db:seed:demo` dijalankan manual ke database itu.
   Deploy Vercel tidak menjalankannya. Dokumen lama repo ini (`PERBAIKAN-UI.md`)
   bahkan sudah mencatat bahwa README menyebut kredensial "yang sebenarnya tidak
   ada di database mana pun".
2. Database produksimu sudah berisi **4 akun** (terukur: `GET /api/auth/register`
   → `{"bootstrap":false,"userCount":4}`), jadi jalur "akun pertama otomatis
   admin" tidak berlaku lagi, dan pendaftaran minta kode undangan.
3. **Pesan error login menyembunyikan penyebabnya.** `page.tsx` membuang respons
   server dan selalu menulis *"Login gagal. Periksa username dan password."* —
   termasuk saat penyebabnya database atau rate limit. Itu yang membuat kita
   berputar menebak password padahal masalahnya bukan di situ.

Lingkaran setannya: kode undangan hanya bisa dibuat dari Panel Admin, dan Panel
Admin butuh login.

## Yang diubah

### 1. Admin pemulihan lewat environment variable

File baru: `src/lib/admin-bootstrap.ts` + `src/lib/admin-bootstrap-config.ts`.
Dipanggil di awal `POST /api/auth/login`.

Isi dua variabel di Vercel, redeploy, login — akun ADMIN dibuat otomatis pada
percobaan login pertama. Tidak perlu membuka SQL Editor.

Janji keselamatan yang dikunci lewat test:

| Aturan | Perilaku |
|---|---|
| Env var tidak diisi | Tidak menyentuh database sama sekali |
| Username sudah ada | **Tidak disentuh** — password maupun role tidak berubah |
| Reset password akun lama | Hanya bila `ADMIN_ALLOW_PASSWORD_RESET="true"` diisi eksplisit |
| Penyimpanan password | Selalu bcrypt; tidak pernah teks asli |
| Log | Password dan hash tidak pernah ditulis; pesan Prisma dipotong ke baris pertama karena baris lanjutannya bisa memuat argumen invokasi |
| Database gagal | Error dicatat lalu ditelan — **tidak bisa menggagalkan login** |
| Dua request bersamaan | Satu akun, bukan dua (memo per proses + tangkap `P2002`) |
| Env berubah | Berlaku setelah redeploy (memo per proses) |

Validasi username/password disamakan dengan `registerSchema`: username 3–50
karakter `huruf/angka/underscore`, password 6–128 karakter. `ADMIN_USERNAME`
di-trim, tetapi **`ADMIN_PASSWORD` tidak di-trim** — spasi bisa bagian sah dari
password, dan memotongnya diam-diam akan membuat pemilik tidak bisa login.

### 2. Pesan error login & daftar jadi jujur

`src/app/page.tsx` sekarang menampilkan pesan asli dari server. Kalau respons
bukan JSON, ditampilkan `Login gagal (HTTP 500)` dan sejenisnya — bukan lagi
menuduh password. Untuk `401` server tetap menjawab generik agar tidak
membocorkan username mana yang terdaftar.

### 3. Versi Node dikunci

`engines.node`: `">=20.19.0"` → **`"22.x"`**; CI ikut pindah ke Node 22.

Rentang terbuka sebelumnya membuat Vercel **mengabaikan** setelan `24.x` di
dashboard dan memakai **Node 26**, lalu otomatis naik ke major berikutnya di masa
depan. Itu terlihat di build log yang kamu kirim. Sekarang terkunci.

### 4. Dokumentasi yang menyesatkan diperbaiki

- `README.md`: peringatan tegas bahwa `admin1/admin123` bukan akun bawaan, plus
  bagian "Tidak bisa masuk sama sekali?".
- `docs/DEPLOY-VERCEL.md`: langkah pemulihan, koreksi cron (harian, bukan lima
  menit), dan larangan mengembalikan `engines` ke rentang terbuka.
- `.env.example`: ketiga variabel baru beserta peringatan menghapusnya.

---

## Langkah untukmu (setelah PR ini di-merge)

1. **Vercel** → proyek `mbg` → **Settings** → **Environment Variables**
2. Tambahkan dua variabel (berlaku untuk **Production**):

   | Name | Value |
   |---|---|
   | `ADMIN_USERNAME` | username baru, misal `pemilik` |
   | `ADMIN_PASSWORD` | password pilihanmu sendiri, minimal 6 karakter |

3. **Deployments** → deployment terbaru → titik tiga → **Redeploy**
4. Buka `https://mbg-xi.vercel.app` → tab **Masuk** → masukkan username & password
   yang baru kamu isi → **Masuk**
5. Cek **Alat → Panel Admin** bisa terbuka. Kalau bisa, kamu sudah ADMIN.
6. **Hapus `ADMIN_USERNAME` dan `ADMIN_PASSWORD`** dari Environment Variables,
   lalu redeploy sekali lagi.

Password tidak perlu dikirim ke mana pun — kamu yang mengetiknya di dashboard
Vercel dan di form login.

Kalau ingin memakai username yang **sudah ada** karena lupa passwordnya,
tambahkan `ADMIN_ALLOW_PASSWORD_RESET="true"` pada langkah 2, lalu hapus lagi di
langkah 6 bersama dua variabel lainnya.

---

## Hasil pemeriksaan

| Gerbang | Hasil |
|---|---|
| `npx tsc --noEmit` | **bersih** |
| `npm test` | **160 lulus**, 1 dilewati (sebelumnya 117 → +44 test baru) |
| `npm run lint:baseline` | **30 error / 0 warning**, tidak ada utang baru |
| `VERCEL=1 npm run build` | **exit 0**, `.next/standalone` tidak dibuat, postbuild melewatkan salinan dengan benar |
| `npm run build` (self-host) | **exit 0**, postbuild menyalin `.next/static` dan `public` |

44 test baru: 31 untuk validasi env (`tests/admin-bootstrap.test.ts`) dan 13 untuk
perilaku terhadap database tiruan (`tests/admin-bootstrap-db.test.ts`).

### Batas pemeriksaan — perlu kamu tahu

- **Ada 2–3 "unhandled rejection" saat `npm test` di sandbox ini.** Penyebabnya
  engine native Prisma tidak bisa diunduh (`binaries.prisma.sh` diblokir jaringan
  sandbox), bukan kode perubahan ini. Terbukti: menjalankan `tests/retention.test.ts`
  sendirian — file yang tidak kusentuh dan tidak mengimpor modul baru — memunculkan
  error yang sama. Di CI GitHub engine-nya terunduh normal.
- **Belum diuji terhadap Postgres sungguhan** di sesi ini (tidak ada database
  lokal). Logika diuji dengan database tiruan; pembuatan akun nyata baru terbukti
  setelah kamu mencoba langkah di atas.
- **Belum diuji di browser.** Perubahan pesan error hanya dibaca lewat kode dan
  type-check, belum diklik di layar.
- Safari/iOS dan Firefox tetap belum teruji seperti sebelumnya.

## Yang tidak dilakukan

- Tidak menanam kredensial apa pun di dalam kode. Kalau repo ini publik, password
  yang tertulis di kode bisa dibaca siapa saja.
- Tidak mengubah schema database, tidak menambah migration, tidak menyentuh data
  yang sudah ada.
- Tidak mengganti `COOKIE_SECRET`, jadi sesi yang sedang aktif tidak batal.
- Tidak menambah fitur ganti password di dalam aplikasi. Setelah masuk, pengelolaan
  user lain tetap lewat Panel Admin (blokir / ubah role).
