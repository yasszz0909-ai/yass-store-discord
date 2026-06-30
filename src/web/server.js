const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('../db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE Broadcast ─────────────────────────────────────────────────────────────
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(payload); } catch (_) {} });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const settings = db.getSettings();
  if (token && token === settings.adminSessionToken) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── Login / Logout ────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const adminPw = db.getSettings().adminPassword || 'admin123';
  if (password !== adminPw) return res.status(401).json({ error: 'Password salah' });
  const token = crypto.randomBytes(18).toString('hex');
  db.updateSetting('adminSessionToken', token);
  res.json({ token });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  db.updateSetting('adminSessionToken', null);
  res.json({ ok: true });
});

// ── SSE ───────────────────────────────────────────────────────────────────────
app.get('/api/events', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) { clearInterval(hb); } }, 25000);
  req.on('close', () => { sseClients.delete(res); clearInterval(hb); });
});

// ── Overview / Stats ──────────────────────────────────────────────────────────
app.get('/api/stats', authMiddleware, (req, res) => {
  const orders     = db.getOrders();
  const items      = db.getItems();
  const categories = db.getCategories();
  const stock      = db.getStock();
  const settings   = db.getSettings();
  const gigRate    = db.getGigRate();

  const done      = orders.filter(o => ['DONE', 'VERIFIED'].includes(o.status));
  const revenue   = done.reduce((s, o) => s + (o.totalPrice || o.price || 0), 0);
  const active    = orders.filter(o => !['DONE', 'CANCELLED', 'VERIFIED', 'REFUNDED'].includes(o.status)).length;
  const pending   = orders.filter(o => o.status === 'PROOF SENT').length;
  const today     = new Date().toDateString();
  const todayOrds = orders.filter(o => new Date(o.date).toDateString() === today);
  const todayRev  = todayOrds.filter(o => ['DONE','VERIFIED'].includes(o.status)).reduce((s,o) => s+(o.totalPrice||o.price||0), 0);
  const gigItems  = items.filter(i => i.type === 'gig').length;
  const totalStock= Object.values(stock).reduce((s, v) => s + (v||0), 0);

  const revByCat = {};
  for (const cat of categories) {
    const catOrders = done.filter(o => o.gameSlug === cat.id);
    revByCat[cat.id] = { name: cat.name, emoji: cat.emoji, revenue: catOrders.reduce((s,o) => s+(o.totalPrice||o.price||0), 0), orders: catOrders.length };
  }

  const lowStockItems = Object.entries(stock)
    .filter(([id, qty]) => qty > 0 && qty <= 3)
    .map(([id]) => { const it = items.find(i => i.id === id); return it ? `${it.emoji} ${it.name}` : id; })
    .slice(0, 5);

  res.json({
    totalOrders: orders.length, totalRevenue: revenue, activeOrders: active,
    pendingVerify: pending, totalItems: items.length, gigItems, totalStock,
    totalCategories: categories.length, openCategories: categories.filter(c => c.isOpen).length,
    totalBans: Object.keys(db.getBans()).length, gigRate, robuxRate: settings.robuxRate || 145,
    todayOrders: todayOrds.length, todayRevenue: todayRev,
    maintenance: db.isMaintenanceMode(),
    revenueByCat: revByCat,
    lowStockItems,
    recentOrders: orders.slice(-10).reverse().map(o => ({
      invoice: o.invoice, userId: o.userId, username: o.username,
      itemName: o.itemName, price: o.totalPrice||o.price||0,
      status: o.status, date: o.date,
    })),
  });
});

// ── Orders ────────────────────────────────────────────────────────────────────
app.get('/api/orders', authMiddleware, (req, res) => {
  let orders = db.getOrders();
  const { status, search, limit } = req.query;
  if (status && status !== 'all') orders = orders.filter(o => o.status === status);
  if (search) {
    const q = search.toLowerCase();
    orders = orders.filter(o =>
      (o.invoice||'').toLowerCase().includes(q) ||
      (o.username||'').toLowerCase().includes(q) ||
      (o.itemName||'').toLowerCase().includes(q) ||
      (o.userId||'').includes(q)
    );
  }
  orders = orders.slice().reverse();
  if (limit) orders = orders.slice(0, parseInt(limit));
  res.json(orders);
});

app.get('/api/orders/:invoice', authMiddleware, (req, res) => {
  const order = db.getOrderByInvoice(req.params.invoice);
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

app.patch('/api/orders/:invoice', authMiddleware, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['ORDER CREATED','WAITING PAYMENT','PROOF SENT','VERIFIED','DONE','CANCELLED','REFUNDED'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.updateOrder(req.params.invoice, { status });
  db.appendOrderLog(req.params.invoice, `Status → ${status}`, 'Web Admin');
  broadcast('order_update', { invoice: req.params.invoice, status });
  res.json({ ok: true });
});

app.post('/api/orders/:invoice/note', authMiddleware, (req, res) => {
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: 'note required' });
  const order = db.addOrderNote(req.params.invoice, note, 'Web Admin');
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ── Export CSV ────────────────────────────────────────────────────────────────
app.get('/api/export/orders', authMiddleware, (req, res) => {
  const { status } = req.query;
  let orders = db.getOrders();
  if (status && status !== 'all') orders = orders.filter(o => o.status === status);
  const header = 'Invoice,Tanggal,Username,UserID,Item,Total,Status,Voucher,Discount\n';
  const rows = orders.map(o =>
    [o.invoice, o.date?.split('T')[0]||'', (o.username||'').replace(/,/g,';'),
     o.userId||'', (o.itemName||'').replace(/,/g,';'),
     o.totalPrice||o.price||0, o.status||'', o.voucherCode||'', o.discount||0].join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="orders_${Date.now()}.csv"`);
  res.send(header + rows);
});

// ── Items ─────────────────────────────────────────────────────────────────────
app.get('/api/items', authMiddleware, (req, res) => {
  let items = db.getItems();
  const stock = db.getStock();
  const { category, type } = req.query;
  if (category) items = items.filter(i => i.categoryId === category);
  if (type)     items = items.filter(i => i.type === type);
  res.json(items.map(i => ({
    ...i, stock: stock[i.id] ?? 0, effectivePrice: db.getItemEffectivePrice(i),
  })));
});

app.post('/api/items', authMiddleware, (req, res) => {
  const { id, name, categoryId, emoji, price, robuxAmount, type, subCategory, amount } = req.body;
  if (!id || !name || !categoryId) return res.status(400).json({ error: 'id, name, categoryId required' });
  const item = { id: id.replace(/\s+/g,'_').toLowerCase(), name, categoryId, emoji: emoji||'📦', price: Number(price)||0, defaultStock: 0 };
  if (type)        item.type = type;
  if (subCategory) item.subCategory = subCategory;
  if (robuxAmount) item.robuxAmount = Number(robuxAmount);
  if (amount)      item.amount = Number(amount);
  if (!db.addItem(item)) return res.status(409).json({ error: 'Item ID sudah ada' });
  broadcast('item_added', { id: item.id });
  res.json({ ok: true, item });
});

app.patch('/api/items/:id', authMiddleware, (req, res) => {
  const { price, robuxAmount, emoji, name } = req.body;
  const updates = {};
  if (price !== undefined)       updates.price = parseInt(price)||0;
  if (robuxAmount !== undefined)  updates.robuxAmount = parseInt(robuxAmount)||0;
  if (emoji) updates.emoji = emoji;
  if (name)  updates.name = name;
  db.updateItem(req.params.id, updates);
  broadcast('item_updated', { id: req.params.id });
  res.json({ ok: true });
});

app.delete('/api/items/:id', authMiddleware, (req, res) => {
  db.removeItem(req.params.id);
  broadcast('item_deleted', { id: req.params.id });
  res.json({ ok: true });
});

// ── Stock ─────────────────────────────────────────────────────────────────────
app.get('/api/stock', authMiddleware, (req, res) => {
  const stock = db.getStock(); const items = db.getItems();
  res.json(items.map(i => ({ ...i, stock: stock[i.id]??0, effectivePrice: db.getItemEffectivePrice(i) })));
});

app.patch('/api/items/:id/stock', authMiddleware, (req, res) => {
  const { amount } = req.body;
  const stock = db.getStock();
  if (!(req.params.id in stock)) return res.status(404).json({ error: 'Not found' });
  stock[req.params.id] = Math.max(0, parseInt(amount)||0);
  db.setStock(stock);
  broadcast('stock_update', { id: req.params.id, stock: stock[req.params.id] });
  res.json({ ok: true, stock: stock[req.params.id] });
});

app.post('/api/stock/bulk', authMiddleware, (req, res) => {
  const { updates } = req.body;
  const stock = db.getStock();
  for (const { id, amount, mode } of (updates||[])) {
    if (!(id in stock)) continue;
    if (mode === 'add') stock[id] = (stock[id]||0) + Number(amount);
    else stock[id] = Math.max(0, Number(amount));
  }
  db.setStock(stock);
  res.json({ ok: true });
});

// ── Categories ────────────────────────────────────────────────────────────────
app.get('/api/categories', authMiddleware, (req, res) => {
  const cats = db.getCategories(); const items = db.getItems(); const stock = db.getStock();
  res.json(cats.map(c => {
    const ci = items.filter(i => i.categoryId === c.id);
    return { ...c, itemCount: ci.length, totalStock: ci.reduce((s,i) => s+(stock[i.id]??0), 0) };
  }));
});

app.patch('/api/categories/:id', authMiddleware, (req, res) => {
  const { isOpen } = req.body;
  db.updateCategory(req.params.id, { isOpen: Boolean(isOpen) });
  broadcast('category_update', { id: req.params.id });
  res.json({ ok: true });
});

// ── Vouchers ──────────────────────────────────────────────────────────────────
app.get('/api/vouchers', authMiddleware, (req, res) => res.json(db.getVouchers()));

app.post('/api/vouchers', authMiddleware, (req, res) => {
  const { code, type, value, maxUses, expiry } = req.body;
  if (!code || !type || !value) return res.status(400).json({ error: 'code, type, value required' });
  const upperCode = code.toUpperCase().replace(/\s+/g,'');
  if (db.getVoucherByCode(upperCode)) return res.status(409).json({ error: 'Kode sudah ada' });
  db.addVoucher({
    code: upperCode, type, value: Number(value), maxUses: Number(maxUses)||(-1),
    usedCount: 0, usedBy: [], expiry: expiry||null, active: true,
    createdBy: 'Web Admin', createdAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

app.patch('/api/vouchers/:code', authMiddleware, (req, res) => {
  const ok = db.updateVoucher(req.params.code, req.body);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.delete('/api/vouchers/:code', authMiddleware, (req, res) => {
  db.deleteVoucher(req.params.code.toUpperCase());
  res.json({ ok: true });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get('/api/analytics', authMiddleware, (req, res) => {
  const days = parseInt(req.query.days)||7;
  const orders = db.getOrders();
  const done = orders.filter(o => ['DONE','VERIFIED'].includes(o.status));
  res.json({
    dailyRevenue:    db.getDailyRevenue(days),
    dailyOrders:     db.getDailyOrders(days),
    topItems:        db.getTopItems(10),
    topBuyers:       db.getTopBuyersData(10),
    statusDist:      db.getStatusDistribution(),
    categoryRevenue: db.getCategoryRevenue(),
    totalRevenue:    done.reduce((s,o) => s+(o.totalPrice||o.price||0), 0),
    totalOrders:     orders.length,
    avgOrderValue:   done.length ? Math.floor(done.reduce((s,o) => s+(o.totalPrice||o.price||0), 0)/done.length) : 0,
    totalVouchers:   db.getVouchers().length,
    vouchersUsed:    db.getVouchers().reduce((s,v) => s+(v.usedCount||0), 0),
  });
});

// ── Reviews ───────────────────────────────────────────────────────────────────
app.get('/api/reviews', authMiddleware, (req, res) => res.json(db.getReviews()));

app.delete('/api/reviews/:idx', authMiddleware, (req, res) => {
  const ok = db.deleteReview(parseInt(req.params.idx));
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.delete('/api/reviews', authMiddleware, (req, res) => { db.clearReviews(); res.json({ ok: true }); });

// ── Settings ──────────────────────────────────────────────────────────────────
app.get('/api/settings', authMiddleware, (req, res) => {
  const s = db.getSettings();
  const config = require('../config');
  const { adminSessionToken, adminPassword, ...safe } = s;
  res.json({ ...safe, gigRate: db.getGigRate(), danaNumber: s.danaNumber||config.dana.number, danaName: s.danaName||config.dana.name });
});

app.patch('/api/settings', authMiddleware, (req, res) => {
  const allowed = ['gigRate','robuxRate','antiSpam','maxOrderPerUser','maintenance','autoDmEnabled','lowStockThreshold','welcomeMessage'];
  for (const key of allowed) { if (req.body[key] !== undefined) db.updateSetting(key, req.body[key]); }
  const config = require('../config');
  if (req.body.danaNumber) { db.updateSetting('danaNumber', req.body.danaNumber); config.dana.number = req.body.danaNumber; }
  if (req.body.danaName)   { db.updateSetting('danaName',   req.body.danaName);   config.dana.name   = req.body.danaName; }
  if (req.body.maintenance !== undefined) db.setMaintenanceMode(req.body.maintenance);
  broadcast('settings_update', {});
  res.json({ ok: true });
});

app.post('/api/settings/password', authMiddleware, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min 6 karakter' });
  db.updateSetting('adminPassword', newPassword);
  res.json({ ok: true });
});

// ── Bans ──────────────────────────────────────────────────────────────────────
app.get('/api/bans', authMiddleware, (req, res) => {
  const bans = db.getBans();
  res.json(Object.entries(bans).map(([userId, info]) => ({ userId, ...info })));
});

app.post('/api/bans', authMiddleware, (req, res) => {
  const { userId, reason } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  db.addBan(userId, reason||'Banned via web admin', 'Web Admin');
  res.json({ ok: true });
});

app.delete('/api/bans/:userId', authMiddleware, (req, res) => {
  db.removeBan(req.params.userId);
  res.json({ ok: true });
});

// ── User Lookup ───────────────────────────────────────────────────────────────
app.get('/api/users/:userId', authMiddleware, (req, res) => {
  const stats = db.getUserStats(req.params.userId);
  const orders = db.getOrders().filter(o => o.userId === req.params.userId).slice().reverse().slice(0,10);
  const banned = db.isBanned(req.params.userId);
  const banInfo = banned ? db.getBans()[req.params.userId] : null;
  res.json({ userId: req.params.userId, ...stats, orders, banned, banInfo });
});

// ── Catch-all ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function startWebServer(port) {
  app.listen(port||5000, '0.0.0.0', () => {
    const pass = db.getSettings().adminPassword||'admin123';
    console.log(`🌐  Web Admin Dashboard → http://0.0.0.0:${port||5000}`);
    console.log(`🔑  Admin Password     → ${pass === 'admin123' ? 'admin123 (default — ubah di Settings!)' : '***'}`);
  });
}

module.exports = { startWebServer, broadcast };
