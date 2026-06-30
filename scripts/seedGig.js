const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const read  = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const write = (f, d) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(d, null, 2));

const GIG_RATE = 86;

// ─────────────────────────────────────────────
// 40 item dari screenshot
// ─────────────────────────────────────────────
const RAW = [
  // LIMITED SKIN 🔑
  { name: 'MEGA Yacht',        sub: 'limited', r: 999,  emoji: '🛥️' },
  { name: 'World Tour Bundle', sub: 'limited', r: 899,  emoji: '🌍' },
  { name: 'Dragon Bundle',     sub: 'limited', r: 999,  emoji: '🐉' },

  // HOT ITEM 🔥
  { name: 'EMOTE CRATES x1',       sub: 'hot', r: 59,   emoji: '🔥' },
  { name: 'EMOTE CRATES x5',       sub: 'hot', r: 295,  emoji: '🔥' },
  { name: 'Ability Spin x1',       sub: 'hot', r: 49,   emoji: '🎯' },
  { name: 'Ability Spin x10',      sub: 'hot', r: 490,  emoji: '🎯' },
  { name: 'Ability Spin x25',      sub: 'hot', r: 1225, emoji: '🎯' },
  { name: 'Arctic Crystal Egg x1', sub: 'hot', r: 109,  emoji: '🥚' },
  { name: 'Arctic Crystal Egg x3', sub: 'hot', r: 327,  emoji: '🥚' },
  { name: 'Arctic Crystal Egg x5', sub: 'hot', r: 545,  emoji: '🥚' },

  // GAMEPASS 🎮
  { name: '[GAMEPASS] VIP + LUCK',     sub: 'gamepass', r: 445,  emoji: '🎮' },
  { name: '[GAMEPASS] Mutation',        sub: 'gamepass', r: 295,  emoji: '🎮' },
  { name: '[GAMEPASS] Advanced Luck',   sub: 'gamepass', r: 545,  emoji: '🎮' },
  { name: '[GAMEPASS] Extra Luck',      sub: 'gamepass', r: 245,  emoji: '🎮' },
  { name: '[GAMEPASS] Double XP',       sub: 'gamepass', r: 195,  emoji: '🎮' },
  { name: '[GAMEPASS] Sell Anywhere',   sub: 'gamepass', r: 315,  emoji: '🎮' },
  { name: '[GAMEPASS] Small Luck',      sub: 'gamepass', r: 50,   emoji: '🎮' },
  { name: '[GAMEPASS] Mini Hoverboat',  sub: 'gamepass', r: 225,  emoji: '🎮' },
  { name: '[GAMEPASS] Hyper Boat Pack', sub: 'gamepass', r: 999,  emoji: '🎮' },

  // CRATES 📦
  { name: '[CRATES] Azure 1x',             sub: 'crates', r: 109, emoji: '🟦' },
  { name: '[CRATES] Azure 5x',             sub: 'crates', r: 545, emoji: '🟦' },
  { name: '[CRATES] Pirate 1x',            sub: 'crates', r: 109, emoji: '☠️' },
  { name: '[CRATES] Pirate 5x',            sub: 'crates', r: 545, emoji: '☠️' },
  { name: '[CRATES] Elderwood 1x',         sub: 'crates', r: 99,  emoji: '🌲' },
  { name: '[CRATES] Elderwood 5x',         sub: 'crates', r: 495, emoji: '🌲' },
  { name: '[CRATES] Luxury 1x',            sub: 'crates', r: 99,  emoji: '💎' },
  { name: '[CRATES] Luxury 5x',            sub: 'crates', r: 495, emoji: '💎' },
  { name: '[CRATES] Mystery 1x (Merchant)',sub: 'crates', r: 114, emoji: '❓' },
  { name: '[CRATES] Mystery 5x (Merchant)',sub: 'crates', r: 570, emoji: '❓' },

  // BOOSTS ⚡
  { name: '[BOOSTS] x8 6 Jam',   sub: 'boost', r: 1300,  emoji: '⚡' },
  { name: '[BOOSTS] x8 9 Jam',   sub: 'boost', r: 1600,  emoji: '⚡' },
  { name: '[BOOSTS] x8 12 Jam',  sub: 'boost', r: 1900,  emoji: '⚡' },
  { name: '[BOOSTS] x8 24 Jam',  sub: 'boost', r: 3100,  emoji: '⚡' },
  { name: '[BOOSTS] x8 48 Jam',  sub: 'boost', r: 5500,  emoji: '⚡' },
  { name: '[BOOSTS] x8 72 Jam',  sub: 'boost', r: 7900,  emoji: '⚡' },
  { name: '[BOOSTS] x8 96 Jam',  sub: 'boost', r: 10300, emoji: '⚡' },
  { name: '[BOOSTS] x8 120 Jam', sub: 'boost', r: 12700, emoji: '⚡' },
  { name: '[BOOSTS] x8 144 Jam', sub: 'boost', r: 15100, emoji: '⚡' },
  { name: '[BOOSTS] x8 168 Jam', sub: 'boost', r: 17500, emoji: '⚡' },
];

// ─────────────────────────────────────────────
// Load data
// ─────────────────────────────────────────────
const items    = read('items.json');
const stock    = read('stock.json') || {};
const settings = read('settings.json');

// Simpan gigRate (terpisah dari robuxRate / Robux Login)
settings.gigRate = GIG_RATE;
write('settings.json', settings);

// ─────────────────────────────────────────────
// Seed items
// ─────────────────────────────────────────────
let added = 0, skipped = 0;

for (const d of RAW) {
  const slug   = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 24);
  const itemId = `gig-${d.sub}-${slug}`.substring(0, 50);

  if (items.find(i => i.id === itemId)) { skipped++; continue; }

  items.push({
    id:           itemId,
    categoryId:   'gift_in_game',
    name:         d.name,
    price:        0,           // dihitung: robuxAmount × gigRate (dinamis)
    robuxAmount:  d.r,
    emoji:        d.emoji,
    type:         'gig',
    subCategory:  d.sub,
    defaultStock: 99,
  });

  stock[itemId] = 99;
  added++;
}

write('items.json', items);
write('stock.json', stock);

console.log('');
console.log('╔══════════════════════════════════════╗');
console.log('║   GiG SEEDER — SELESAI               ║');
console.log('╠══════════════════════════════════════╣');
console.log(`║  ✅ Ditambahkan : ${String(added).padEnd(18)}║`);
console.log(`║  ⏭️  Dilewati   : ${String(skipped).padEnd(18)}║`);
console.log(`║  💰 gigRate     : Rp${String(GIG_RATE + '/R$').padEnd(16)}║`);
console.log('╚══════════════════════════════════════╝');
