# 🔐 Yass Store Bot — Panduan Secrets

Semua secrets disimpan di **Replit Secrets** (ikon gembok 🔒 di sidebar kiri).
Klik ikon tersebut untuk melihat, menambah, atau mengubah nilai.

---

## Daftar Secrets yang Dibutuhkan

| Key | Keterangan | Cara Dapat |
|-----|-----------|------------|
| `DISCORD_TOKEN` | Token login bot | [discord.com/developers](https://discord.com/developers/applications) → Pilih App → **Bot** → **Reset Token** |
| `GUILD_ID` | ID Server Discord | Klik kanan nama server → **Copy Server ID** (aktifkan Developer Mode dulu) |
| `STAFF_ROLE_ID` | ID Role Staff | Server Settings → Roles → klik kanan role → **Copy Role ID** |

---

## Cara Aktifkan Developer Mode di Discord

1. Buka Discord → **User Settings** (ikon roda gigi)
2. Pilih **Advanced**
3. Aktifkan **Developer Mode**
4. Sekarang kamu bisa klik kanan untuk **Copy ID**

---

## Konfigurasi Non-Secret (bisa diubah di bot)

| Setting | Command | Keterangan |
|---------|---------|-----------|
| Nomor DANA | `/setpayment` | Update nomor & nama rekening DANA |
| Log Channel | `/setlogchannel` | Set channel untuk log transaksi |
| Maintenance | `/maintenance` | Toggle mode maintenance |
| Low Stock Alert | `/setsettings` | Atur threshold alert stock rendah |

---

## Cara Reset Token (jika lupa/bocor)

1. Buka [discord.com/developers](https://discord.com/developers/applications)
2. Pilih aplikasi bot kamu
3. Klik tab **Bot**
4. Klik **Reset Token** → konfirmasi
5. Copy token baru
6. Buka Replit → klik ikon 🔒 Secrets
7. Cari `DISCORD_TOKEN` → klik edit → paste token baru
8. Restart bot

---

*File ini aman untuk disimpan — tidak mengandung nilai secret apapun.*
