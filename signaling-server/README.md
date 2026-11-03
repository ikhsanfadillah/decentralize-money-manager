# DMM Stateless WebRTC Signaling & STUN/TURN Infrastructure

Folder ini berisi server **Signaling WebSocket Zero-Knowledge** dan template konfigurasi **STUN/TURN** untuk mode WebApp (PWA) P2P Money Manager.

## 1. Mode Development Lokal (Otomatis / Zero-Setup)

Saat Anda menjalankan `pnpm dev` atau `pnpm preview`, Vite secara otomatis menyertakan middleware signaling pada endpoint:
- `ws://localhost:1420/__dmm_signal/ws/invite/:roomId`
- `ws://localhost:1420/__dmm_signal/ws/topic/:topicId`

Anda juga dapat menjalankan server signaling mandiri (standalone Node.js tanpa dependensi tambahan) di port `8787`:

```bash
pnpm signal:server
```

Cek status server:
```bash
curl http://localhost:8787/healthz
```

## 2. Deploy Gratis ke Cloudflare Workers (Serverless)

Untuk penggunaan lintas jaringan (internet publik) dengan biaya $0:

```bash
cd signaling-server
npx wrangler deploy
```

Lalu isi URL Worker Anda di `.env`:
```env
VITE_SIGNALING_URL="wss://dmm-webrtc-signaling.<subdomain-anda>.workers.dev"
```

## 3. Konfigurasi TURN Relay Server (Penembus CGNAT / Symmetric NAT)

Agar dua perangkat di balik jaringan seluler 4G/5G (CGNAT) atau firewall kantor ketat tetap bisa terhubung 99,9%:

### Opsi A: Metered.ca Free Tier (50 GB/bulan Gratis)
Daftar di [Metered.ca TURN](https://www.metered.ca/stun-turn) lalu masukkan kredensial ke `.env`:

```env
VITE_TURN_URLS="turn:standard.relay.metered.ca:80,turn:standard.relay.metered.ca:443,turns:standard.relay.metered.ca:443?transport=tcp"
VITE_TURN_USERNAME="username_metered_anda"
VITE_TURN_CREDENTIAL="password_metered_anda"
```

### Opsi B: Self-Hosted `coturn` di VPS Sendiri
Salin `coturn.conf.example` ke `/etc/turnserver.conf` di VPS Ubuntu/Debian Anda, aktifkan layanan `coturn`, lalu isi variabel `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, dan `VITE_TURN_CREDENTIAL` di `.env`.

