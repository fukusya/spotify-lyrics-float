# Spotify Lyrics Float

Extension Chrome yang menampilkan kotak lirik kecil, selalu-di-atas (floating),
yang tersinkron dengan lagu yang lagi kamu putar di akun Spotify — baik dari
aplikasi desktop, mobile, maupun web player. Box-nya tetap kelihatan meskipun
kamu pindah ke aplikasi lain di luar Chrome.

## Cara kerja singkat

- **Deteksi lagu**: pakai Spotify Web API (`/me/player/currently-playing`)
  lewat akunmu sendiri (OAuth), bukan scraping tab — jadi tetap jalan walau
  Spotify-nya dibuka di aplikasi desktop.
- **Lirik**: diambil dari [LRCLIB](https://lrclib.net) (gratis, tanpa API key,
  mendukung lirik tersinkron per baris).
- **Selalu di atas**: pakai
  [Document Picture-in-Picture API](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API)
  bawaan Chrome — window kecil yang beneran mengambang di atas jendela/aplikasi
  lain, mirip PiP video YouTube. Butuh **Chrome/Edge 116+**.

## Instalasi

1. Buka `chrome://extensions`, aktifkan **Developer mode** (pojok kanan atas).
2. Klik **Load unpacked**, pilih folder `spotify-lyrics-float` ini.
3. Klik ikon extension di toolbar → **Buka Lyrics Float**. Ini akan membuka
   tab kontrol (`host.html`) — **biarkan tab ini tetap terbuka**, karena kotak
   mengambang "menempel" pada tab ini (kalau tab ini ditutup, kotaknya ikut
   hilang). Tab ini boleh kamu taruh di background/tab paling belakang.

## Setup akun Spotify (sekali saja)

1. Buka [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   → **Create app**. Isi nama & deskripsi bebas.
2. Di tab kontrol extension, salin nilai **Redirect URI** yang tertera (tombol
   Copy), lalu tempel ke kolom **Redirect URIs** di pengaturan app Spotify-mu
   → **Save**.
3. Kembali ke Spotify Dashboard → **Settings** app tadi → salin **Client ID**.
4. Tempel Client ID itu ke kolom di tab kontrol extension → **Simpan**.
5. Klik **Connect ke Spotify**, login & izinkan akses (scope yang dipakai
   hanya `user-read-currently-playing` dan `user-read-playback-state`).

## Pemakaian

- Putar lagu apa saja di Spotify (device apa pun).
- Di tab kontrol, klik ikon ⧉ untuk membuka kotak lirik mengambang.
- Klik ikon ⧉ lagi (atau tombol "kembali ke tab" di title bar kotaknya) untuk
  menutup mode mengambang.
- Klik ikon ⏻ untuk disconnect akun Spotify kapan saja.

## Batasan yang perlu diketahui

- Document Picture-in-Picture adalah fitur Chromium — tidak akan berfungsi di
  Firefox/Safari.
- Tidak semua lagu punya lirik tersinkron di LRCLIB; kalau tidak ada, box
  akan menampilkan lirik polos (tanpa highlight per baris) atau pesan "lirik
  tidak ditemukan".
- Sesuai kebijakan Spotify Developer, lirik yang ditampilkan berasal dari
  LRCLIB (pihak ketiga), bukan data lirik resmi Spotify — extension hanya
  memakai metadata lagu (judul, artis, cover) dari Spotify untuk mencocokkan
  lirik, lengkap dengan atribusi ke Spotify di bagian bawah box.
