// ── State ─────────────────────────────────────────────────────────────────────
let TOKEN = localStorage.getItem('yass_token') || '';
let _stockData = [], _itemsData = [], _charts = {};

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method: method||'GET', headers: { 'x-admin-token': TOKEN, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (path.includes('/export/')) return res; // raw for CSV
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}
const get    = (p)       => api('GET',    p);
const post   = (p, body) => api('POST',   p, body);
const patch  = (p, body) => api('PATCH',  p, body);
const del    = (p)       => api('DELETE', p);

// ── Format ────────────────────────────────────────────────────────────────────
const rp  = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const dt  = (s) => new Date(s).toLocaleString('id-ID', { timeZone:'Asia/Jakarta', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
const dtShort = (s) => s ? s.split('T')[0] : '—';
const pct = (n, total) => total ? Math.round((n/total)*100) : 0;

const statusBadge = (s) => {
  const map = {
    'ORDER CREATED':   ['badge-created',  '🟡 Created'],
    'WAITING PAYMENT': ['badge-waiting',  '🟠 Waiting'],
    'PROOF SENT':      ['badge-proof',    '🔵 Proof Sent'],
    'VERIFIED':        ['badge-verified', '🟢 Verified'],
    'DONE':            ['badge-done',     '⚫ Done'],
    'CANCELLED':       ['badge-cancelled','❌ Cancelled'],
    'REFUNDED':        ['badge-refunded', '🔄 Refunded'],
  };
  const [cls, label] = map[s] || ['badge-done', s];
  return `<span class="badge ${cls}">${label}</span>`;
};

function starDisplay(n) {
  const stars = Math.round(Number(n)||0);
  return '⭐'.repeat(Math.max(0, Math.min(5, stars))) + '☆'.repeat(Math.max(0, 5-stars));
}

// ── Toast & Modal ─────────────────────────────────────────────────────────────
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', 3500);
}
function showModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }
function handleOverlayClick(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); }

// ── Theme Toggle ──────────────────────────────────────────────────────────────
function toggleTheme() {
  const isLight = document.body.classList.toggle('light');
  document.getElementById('btn-theme').textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('yass_theme', isLight ? 'light' : 'dark');
}
if (localStorage.getItem('yass_theme') === 'light') {
  document.body.classList.add('light');
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = '☀️';
  });
}

// ── SSE Real-time ─────────────────────────────────────────────────────────────
let _sseSource = null;
function connectSSE() {
  if (_sseSource) _sseSource.close();
  _sseSource = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
  _sseSource.addEventListener('order_update', (e) => {
    const d = JSON.parse(e.data);
    showNotif(`📋 Order ${d.invoice} → ${d.status}`);
    // Auto-refresh if on orders page
    if (document.getElementById('section-orders').classList.contains('active')) loadOrders();
    if (document.getElementById('section-overview').classList.contains('active')) loadOverview();
  });
  _sseSource.addEventListener('item_added', () => { loadItems(); loadGig(); });
  _sseSource.addEventListener('stock_update', () => {
    if (document.getElementById('section-stock').classList.contains('active')) loadStock();
  });
  _sseSource.addEventListener('settings_update', () => {
    if (document.getElementById('section-settings').classList.contains('active')) loadSettings();
  });
  _sseSource.onerror = () => {
    _sseSource.close();
    setTimeout(() => { if (TOKEN) connectSSE(); }, 10000);
  };
}

function showNotif(msg) {
  const bar = document.getElementById('notif-bar');
  document.getElementById('notif-text').textContent = msg;
  bar.style.display = 'flex';
  setTimeout(() => bar.style.display = 'none', 7000);
}

// ── Chart Helper ──────────────────────────────────────────────────────────────
function destroyChart(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }

function makeLineChart(id, labels, datasets) {
  destroyChart(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: datasets.map(d => ({
      tension: 0.4, fill: true, borderWidth: 2, pointRadius: 3,
      backgroundColor: d.color + '22', borderColor: d.color,
      ...d,
    })) },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: datasets.length > 1, labels: { color: '#9898b8', boxWidth: 12 } } },
      scales: { x: { ticks: { color: '#9898b8', maxTicksLimit: 7 }, grid: { color: '#2a2a45' } }, y: { ticks: { color: '#9898b8', callback: v => v >= 1000 ? (v/1000).toFixed(0)+'k' : v }, grid: { color: '#2a2a45' } } },
    },
  });
}

function makePieChart(id, labels, data, colors) {
  destroyChart(id);
  const ctx = document.getElementById(id)?.getContext('2d');
  if (!ctx) return;
  _charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9898b8', boxWidth: 12, padding: 10 } } } },
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const data = await post('/api/login', { password: pass });
    TOKEN = data.token;
    localStorage.setItem('yass_token', TOKEN);
    showApp();
  } catch (err) {
    errEl.textContent = '❌ ' + err.message;
    errEl.style.display = 'block';
  }
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  try { await post('/api/logout'); } catch (_) {}
  if (_sseSource) _sseSource.close();
  localStorage.removeItem('yass_token');
  TOKEN = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
});

async function checkAuth() {
  if (!TOKEN) return;
  try { await get('/api/stats'); showApp(); }
  catch (_) { localStorage.removeItem('yass_token'); TOKEN = ''; }
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadOverview();
  populateCatFilter();
  connectSSE();
  setInterval(loadOverview, 60000);
}

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const section = item.dataset.section;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`section-${section}`)?.classList.add('active');
    const loaders = {
      overview: loadOverview, orders: loadOrders, analytics: loadAnalytics,
      gig: loadGig, items: loadItems, categories: loadCategories,
      stock: loadStock, settings: loadSettings, bans: loadBans,
      vouchers: loadVouchers, reviews: loadReviews,
    };
    if (loaders[section]) loaders[section]();
  });
});

// ── Overview ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const s = await get('/api/stats');
    // Maintenance badge
    const badge = document.getElementById('ov-maint-badge');
    if (s.maintenance) { badge.style.display = 'inline'; badge.textContent = '🔧 Maintenance ON'; badge.className = 'badge badge-cancelled'; }
    else badge.style.display = 'none';

    const statCards = [
      { label: 'Total Orders',   value: s.totalOrders,   sub: `+${s.todayOrders} hari ini`,    cls: 'accent' },
      { label: 'Total Revenue',  value: rp(s.totalRevenue), sub: `+${rp(s.todayRevenue)} hari ini`, cls: 'gold' },
      { label: 'Active Tickets', value: s.activeOrders,  sub: 'belum selesai',                  cls: s.activeOrders > 0 ? 'warning' : 'success' },
      { label: 'Pending Verify', value: s.pendingVerify, sub: 'butuh diverifikasi',              cls: s.pendingVerify > 0 ? 'danger' : '' },
      { label: 'Total Items',    value: s.totalItems,    sub: `${s.gigItems} GiG items`,         cls: 'purple' },
      { label: 'GiG Rate',       value: `Rp ${s.gigRate}`, sub: 'per Robux (R$)',               cls: 'gold' },
      { label: 'Total Stock',    value: s.totalStock,    sub: 'semua item',                      cls: '' },
      { label: 'Ban List',       value: s.totalBans,     sub: 'user di-ban',                    cls: s.totalBans > 0 ? 'danger' : '' },
    ];
    document.getElementById('stats-grid').innerHTML = statCards.map(c => `
      <div class="stat-card ${c.cls}">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-sub">${c.sub}</div>
      </div>`).join('');

    // Revenue chart
    const rev7 = s.dailyRevenue || {};
    if (Object.keys(rev7).length > 0) {
      const labels = Object.keys(rev7).map(k => { const d = new Date(k); return `${d.getDate()}/${d.getMonth()+1}`; });
      const values = Object.values(rev7);
      makeLineChart('chart-revenue', labels, [{ label: 'Revenue', data: values, color: '#f0c27f' }]);
    }

    // Alerts
    const alerts = [];
    if (s.maintenance) alerts.push({ icon: '🔧', text: 'Mode maintenance AKTIF', cls: 'color-warning' });
    if (s.pendingVerify > 0) alerts.push({ icon: '🔵', text: `${s.pendingVerify} order menunggu verifikasi`, cls: 'color-accent' });
    if (s.activeOrders > 5) alerts.push({ icon: '⚠️', text: `${s.activeOrders} ticket aktif sekarang`, cls: 'color-warning' });
    if ((s.lowStockItems||[]).length > 0) alerts.push({ icon: '📦', text: `Low stock: ${s.lowStockItems.join(', ')}`, cls: 'color-danger' });
    document.getElementById('ov-alerts').innerHTML = alerts.length === 0
      ? `<div class="alert-all-ok">✅ Semua aman!</div>`
      : alerts.map(a => `<div class="alert-item"><span class="alert-icon">${a.icon}</span><span class="${a.cls}">${a.text}</span></div>`).join('');

    // Recent orders
    document.getElementById('recent-orders-table').innerHTML = s.recentOrders.length === 0
      ? `<div class="empty-state"><div class="emoji">📋</div>Belum ada order</div>`
      : `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>User</th><th>Item</th><th>Total</th><th>Status</th></tr></thead><tbody>
        ${s.recentOrders.map(o => `<tr>
          <td class="td-mono" style="cursor:pointer;color:var(--accent)" onclick="viewSection('orders',()=>showOrderDetail('${o.invoice}'))">${o.invoice}</td>
          <td>${(o.username||o.userId||'').substring(0,20)}</td>
          <td>${(o.itemName||'').substring(0,22)}</td>
          <td class="color-gold">${rp(o.price)}</td>
          <td>${statusBadge(o.status)}</td>
        </tr>`).join('')}
      </tbody></table></div>`;

    // Revenue by cat
    const cats = Object.values(s.revenueByCat||{}).sort((a,b) => b.revenue - a.revenue);
    const maxRev = Math.max(...cats.map(c => c.revenue), 1);
    document.getElementById('rev-by-cat').innerHTML = cats.length === 0
      ? `<div class="empty-state"><div class="emoji">💰</div>Belum ada revenue</div>`
      : cats.map(c => `
        <div class="rev-item">
          <div style="flex:1;min-width:0">
            <div class="rev-name">${c.emoji} ${c.name}</div>
            <div class="rev-bar" style="width:${pct(c.revenue,maxRev)}%;"></div>
            <div class="rev-cnt">${c.orders} order</div>
          </div>
          <div class="rev-val">${rp(c.revenue)}</div>
        </div>`).join('');
  } catch (err) { toast('Gagal load overview: ' + err.message, 'error'); }
}

function viewSection(section, cb) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  if (cb) setTimeout(cb, 300);
}

// ── Orders ────────────────────────────────────────────────────────────────────
async function loadOrders() {
  const status = document.getElementById('order-filter')?.value || 'all';
  const search = document.getElementById('order-search')?.value || '';
  try {
    const orders = await get(`/api/orders?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}`);
    if (orders.length === 0) {
      document.getElementById('orders-table').innerHTML = `<div class="empty-state"><div class="emoji">📋</div>Tidak ada order</div>`;
      return;
    }
    document.getElementById('orders-table').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>User</th><th>Item</th><th>Total</th><th>Status</th><th>Tanggal</th><th>Aksi</th></tr></thead>
      <tbody>${orders.map(o => `<tr>
        <td class="td-mono">${o.invoice}${o.isManual?' <span class="badge badge-manual">GiG</span>':''}</td>
        <td>${(o.username||o.userId||'').substring(0,18)}</td>
        <td>${(o.itemName||'—').substring(0,28)}${o.voucherCode?` <span class="badge badge-active">🎫${o.voucherCode}</span>`:''}</td>
        <td class="color-gold">${rp(o.totalPrice||o.price||0)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="color-muted">${dt(o.date)}</td>
        <td><button class="btn btn-xs btn-secondary" onclick="showOrderDetail('${o.invoice}')">👁 Detail</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  } catch (err) { toast('Gagal load orders: ' + err.message, 'error'); }
}

async function showOrderDetail(invoice) {
  try {
    const o = await get(`/api/orders/${invoice}`);
    const items = (o.items||[]).map(i => `<li>${i.emoji||'📦'} ${i.name} ×${i.quantity||1} = ${rp(i.price*(i.quantity||1))}</li>`).join('');
    const logHtml = (o.log||[]).slice().reverse().map(l => `<li><span class="log-event">${l.event}</span> — ${l.by} <span class="color-muted">${dtShort(l.at)}</span></li>`).join('');
    const notesHtml = (o.notes||[]).map(n => `<li><b>${n.by}</b>: ${n.note} <span class="color-muted">${dtShort(n.at)}</span></li>`).join('');
    showModal(`🧾 ${invoice}`, `
      <div class="detail-row"><div class="detail-label">Pembeli</div><div class="detail-value">${o.username||'—'} <span class="color-muted">(${o.userId})</span></div></div>
      <div class="detail-row"><div class="detail-label">Item</div><div class="detail-value">${o.itemName||'—'}${o.robuxAmount?` <span class="color-gold">©${o.robuxAmount}</span>`:''}</div></div>
      <div class="detail-row"><div class="detail-label">Total</div><div class="detail-value color-gold">${rp(o.totalPrice||o.price||0)}${o.discount?` <span class="color-muted">(diskon ${rp(o.discount)})</span>`:''}</div></div>
      ${o.voucherCode?`<div class="detail-row"><div class="detail-label">Voucher</div><div class="detail-value"><span class="badge badge-active">🎫 ${o.voucherCode}</span></div></div>`:''}
      <div class="detail-row"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(o.status)}</div></div>
      <div class="detail-row"><div class="detail-label">Tanggal</div><div class="detail-value">${dt(o.date)}</div></div>
      ${items?`<div class="detail-row"><div class="detail-label">Items</div><div class="detail-value"><ul style="padding-left:14px;margin:0">${items}</ul></div></div>`:''}
      ${o.paymentProofURL?`<div class="detail-row"><div class="detail-label">Bukti</div><div class="detail-value"><a href="${o.paymentProofURL}" target="_blank" class="color-accent">Lihat bukti ↗</a></div></div>`:''}
      ${logHtml?`<div class="sep"></div><div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;margin-bottom:6px">Log</div><ul class="log-list">${logHtml}</ul>`:''}
      ${notesHtml?`<div class="sep"></div><div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;margin-bottom:6px">Catatan</div><ul class="notes-list">${notesHtml}</ul>`:''}
      <div class="modal-actions">
        <select id="status-sel-${invoice}">${['ORDER CREATED','WAITING PAYMENT','PROOF SENT','VERIFIED','DONE','CANCELLED','REFUNDED'].map(s=>`<option value="${s}"${o.status===s?' selected':''}>${s}</option>`).join('')}</select>
        <button class="btn btn-success btn-sm" onclick="saveOrderStatus('${invoice}')">💾 Update Status</button>
        <button class="btn btn-secondary btn-sm" onclick="addOrderNote('${invoice}')">📝 Catatan</button>
      </div>`);
  } catch (err) { toast('Gagal load detail', 'error'); }
}

async function saveOrderStatus(invoice) {
  const status = document.getElementById(`status-sel-${invoice}`)?.value;
  if (!status) return;
  try {
    await patch(`/api/orders/${invoice}`, { status });
    toast(`✅ Status ${invoice} → ${status}`);
    closeModal();
    loadOrders();
  } catch (err) { toast('Gagal update: ' + err.message, 'error'); }
}

async function addOrderNote(invoice) {
  const note = prompt('Catatan untuk order ' + invoice + ':');
  if (!note) return;
  try {
    await post(`/api/orders/${invoice}/note`, { note });
    toast('✅ Catatan ditambahkan');
    showOrderDetail(invoice);
  } catch (err) { toast('Gagal tambah catatan', 'error'); }
}

async function exportOrders() {
  const status = document.getElementById('order-filter')?.value || 'all';
  try {
    const res = await fetch(`/api/export/orders?status=${encodeURIComponent(status)}&token=${TOKEN}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orders_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('✅ CSV didownload!');
  } catch (err) { toast('Gagal export: ' + err.message, 'error'); }
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const days = document.getElementById('analytics-days')?.value || 7;
  try {
    const a = await get(`/api/analytics?days=${days}`);

    // Stat cards
    document.getElementById('analytics-stat-grid').innerHTML = [
      { label: 'Total Revenue',    value: rp(a.totalRevenue),      cls: 'gold' },
      { label: 'Total Orders',     value: a.totalOrders,           cls: 'accent' },
      { label: 'Avg Order Value',  value: rp(a.avgOrderValue),     cls: 'purple' },
      { label: 'Vouchers Dipakai', value: a.vouchersUsed,          cls: '' },
    ].map(c => `<div class="stat-card ${c.cls}"><div class="stat-label">${c.label}</div><div class="stat-value">${c.value}</div></div>`).join('');

    // Revenue chart
    const revLabels = Object.keys(a.dailyRevenue).map(k => { const d = new Date(k); return `${d.getDate()}/${d.getMonth()+1}`; });
    makeLineChart('chart-analytics-rev', revLabels, [{ label: 'Revenue', data: Object.values(a.dailyRevenue), color: '#f0c27f' }]);

    // Orders chart
    const ordLabels = Object.keys(a.dailyOrders).map(k => { const d = new Date(k); return `${d.getDate()}/${d.getMonth()+1}`; });
    makeLineChart('chart-analytics-ord', ordLabels, [{ label: 'Orders', data: Object.values(a.dailyOrders), color: '#5865f2' }]);

    // Top items
    const maxRev = Math.max(...(a.topItems||[]).map(i => i.revenue), 1);
    document.getElementById('analytics-top-items').innerHTML = !a.topItems?.length
      ? `<div class="empty-state"><div class="emoji">📦</div>Belum ada data</div>`
      : a.topItems.map((it,i) => `
        <div class="rev-item">
          <div style="flex:1;min-width:0">
            <div class="rev-name">${i+1}. ${it.name}</div>
            <div class="rev-bar" style="width:${pct(it.revenue,maxRev)}%"></div>
            <div class="rev-cnt">${it.count} terjual</div>
          </div>
          <div class="rev-val">${rp(it.revenue)}</div>
        </div>`).join('');

    // Top buyers
    const maxB = Math.max(...(a.topBuyers||[]).map(b => b.revenue), 1);
    document.getElementById('analytics-top-buyers').innerHTML = !a.topBuyers?.length
      ? `<div class="empty-state"><div class="emoji">👤</div>Belum ada data</div>`
      : a.topBuyers.map((b,i) => `
        <div class="rev-item">
          <div style="flex:1;min-width:0">
            <div class="rev-name">${i+1}. ${b.username||b.userId}</div>
            <div class="rev-bar" style="width:${pct(b.revenue,maxB)}%;background:var(--purple)"></div>
            <div class="rev-cnt">${b.count} order</div>
          </div>
          <div class="rev-val">${rp(b.revenue)}</div>
        </div>`).join('');

    // Status pie
    const statusColors = { 'ORDER CREATED':'#f0c27f','WAITING PAYMENT':'#faa61a','PROOF SENT':'#5865f2','VERIFIED':'#3ba55c','DONE':'#666','CANCELLED':'#ed4245','REFUNDED':'#9b59b6' };
    const dist = a.statusDist || {};
    makePieChart('chart-status-pie', Object.keys(dist), Object.values(dist), Object.keys(dist).map(k => statusColors[k]||'#888'));

    // Category pie
    const catRev = a.categoryRevenue || {};
    makePieChart('chart-cat-pie', Object.keys(catRev), Object.values(catRev), ['#f0c27f','#5865f2','#3ba55c','#faa61a','#9b59b6']);

  } catch (err) { toast('Gagal load analytics: ' + err.message, 'error'); }
}

// ── GiG Manager ───────────────────────────────────────────────────────────────
async function loadGig() {
  try {
    const settings = await get('/api/settings');
    const gigRate  = settings.gigRate || 86;
    document.getElementById('gig-rate-display').textContent = `Rp ${gigRate}/R$`;
    document.getElementById('gig-rate-input').value = gigRate;
    const examples = [59,109,295,445,545,999,1300,5500].map(r =>
      `<span class="rate-example-chip">©${r} = ${rp(r*gigRate)}</span>`).join('');
    document.getElementById('gig-rate-examples').innerHTML = `<span class="color-muted" style="font-size:11px;align-self:center">Contoh:</span> ${examples}`;

    const sub = document.getElementById('gig-sub-filter')?.value || 'all';
    const items = await get('/api/items?category=gift_in_game');
    const filtered = sub === 'all' ? items : items.filter(i => i.subCategory === sub);
    const subColors = { limited:'color-gold', hot:'color-danger', gamepass:'color-accent', crates:'color-warning', boost:'color-purple' };
    document.getElementById('gig-items-table').innerHTML = filtered.length === 0
      ? `<div class="empty-state"><div class="emoji">🎁</div>Tidak ada item</div>`
      : `<div class="table-wrap"><table>
        <thead><tr><th></th><th>Nama</th><th>Sub</th><th>©Robux</th><th>Harga</th><th>Stock</th><th>Aksi</th></tr></thead>
        <tbody>${filtered.map(i => `<tr>
          <td>${i.emoji}</td>
          <td>${i.name}</td>
          <td><span class="badge ${subColors[i.subCategory]||''}">${i.subCategory||'—'}</span></td>
          <td class="td-mono">©${i.robuxAmount||0}</td>
          <td class="color-gold">${rp(i.effectivePrice||0)}</td>
          <td><div class="inline-edit"><input type="number" id="stk-${i.id}" value="${i.stock}" min="0"><button class="btn btn-xs btn-success" onclick="saveStock('${i.id}')">💾</button></div></td>
          <td><button class="btn btn-xs btn-danger" onclick="deleteItem('${i.id}','${i.name}')">🗑</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  } catch (err) { toast('Gagal load GiG: ' + err.message, 'error'); }
}

async function saveGigRate() {
  const rate = parseInt(document.getElementById('gig-rate-input').value);
  if (!rate || rate <= 0) return toast('Rate tidak valid', 'error');
  try { await patch('/api/settings', { gigRate: rate }); toast(`✅ GiG Rate → Rp ${rate}/R$`); loadGig(); }
  catch (err) { toast('Gagal simpan: ' + err.message, 'error'); }
}

// ── All Items ─────────────────────────────────────────────────────────────────
async function loadItems() {
  const cat = document.getElementById('items-cat-filter')?.value || '';
  try {
    let url = '/api/items'; if (cat) url += `?category=${encodeURIComponent(cat)}`;
    _itemsData = await get(url);
    renderItemsTable(_itemsData);
  } catch (err) { toast('Gagal load items: ' + err.message, 'error'); }
}

function filterItemsTable() {
  const q = (document.getElementById('items-search')?.value||'').toLowerCase();
  renderItemsTable(_itemsData.filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)));
}

function renderItemsTable(items) {
  document.getElementById('items-table').innerHTML = items.length === 0
    ? `<div class="empty-state"><div class="emoji">📦</div>Tidak ada item</div>`
    : `<div class="table-wrap"><table>
      <thead><tr><th></th><th>Nama</th><th>ID</th><th>Kategori</th><th>Type</th><th>Harga</th><th>Stock</th><th>Aksi</th></tr></thead>
      <tbody>${items.map(i => `<tr>
        <td>${i.emoji||'📦'}</td>
        <td>${i.name}</td>
        <td class="td-mono">${i.id}</td>
        <td class="color-muted">${i.categoryId||'—'}</td>
        <td>${i.type==='gig'?'<span class="badge badge-gig">GiG</span>':`<span class="badge">${i.type||'regular'}</span>`}</td>
        <td class="color-gold">${i.type==='gig'?`©${i.robuxAmount} = ${rp(i.effectivePrice)}`:rp(i.effectivePrice||0)}</td>
        <td>${i.stock}</td>
        <td>
          <button class="btn btn-xs btn-secondary" onclick="showEditItemModal('${i.id}','${i.name}',${JSON.stringify(i).replace(/'/g,"\'")})">✏️</button>
          <button class="btn btn-xs btn-danger" onclick="deleteItem('${i.id}','${i.name}')">🗑</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
}

async function populateCatFilter() {
  try {
    const cats = await get('/api/categories');
    const sel = document.getElementById('items-cat-filter');
    if (!sel) return;
    cats.forEach(c => { const o = document.createElement('option'); o.value=c.id; o.textContent=`${c.emoji} ${c.name}`; sel.appendChild(o); });
  } catch (_) {}
}

async function deleteItem(id, name) {
  if (!confirm(`Hapus item "${name}"?`)) return;
  try { await del(`/api/items/${id}`); toast(`🗑 "${name}" dihapus`); loadItems(); loadGig(); }
  catch (err) { toast('Gagal hapus: ' + err.message, 'error'); }
}

function showAddItemModal() {
  showModal('➕ Tambah Item Baru', `
    <div class="form-group"><label>ID Item (unik, tanpa spasi)</label><input id="ai-id" placeholder="ff_diamond_100"></div>
    <div class="form-group"><label>Nama Item</label><input id="ai-name" placeholder="💎 100 Diamond FF"></div>
    <div class="form-group"><label>Emoji</label><input id="ai-emoji" placeholder="💎" style="width:80px"></div>
    <div class="form-group"><label>Kategori</label><select id="ai-cat">
      <option value="freefire">🔥 Free Fire</option>
      <option value="mobilelegend">📱 Mobile Legend</option>
      <option value="gift_in_game">🎁 Gift in Game</option>
      <option value="skin_fish_it">🐟 Skin Fish It</option>
      <option value="robux_login">🎮 Robux Login</option>
    </select></div>
    <div class="form-group"><label>Tipe</label><select id="ai-type" onchange="onItemTypeChange()">
      <option value="">Regular (harga tetap)</option>
      <option value="gig">GiG (harga dari rate × Robux)</option>
    </select></div>
    <div id="ai-price-row" class="form-group"><label>Harga (Rp)</label><input id="ai-price" type="number" min="0" placeholder="5000"></div>
    <div id="ai-robux-row" class="form-group" style="display:none"><label>Jumlah Robux (©)</label><input id="ai-robux" type="number" min="1" placeholder="100"></div>
    <div id="ai-sub-row" class="form-group" style="display:none"><label>Sub Kategori (untuk GiG)</label>
      <select id="ai-sub"><option value="">—</option><option value="limited">🔑 Limited</option><option value="hot">🔥 Hot</option><option value="gamepass">🎮 Gamepass</option><option value="crates">📦 Crates</option><option value="boost">⚡ Boost</option></select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="doAddItem()">➕ Tambah Item</button>
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
    </div>`);
}

function onItemTypeChange() {
  const type = document.getElementById('ai-type')?.value;
  document.getElementById('ai-price-row').style.display = type === 'gig' ? 'none' : '';
  document.getElementById('ai-robux-row').style.display = type === 'gig' ? '' : 'none';
  document.getElementById('ai-sub-row').style.display   = type === 'gig' ? '' : 'none';
}

async function doAddItem() {
  const id    = document.getElementById('ai-id').value.trim();
  const name  = document.getElementById('ai-name').value.trim();
  const emoji = document.getElementById('ai-emoji').value.trim() || '📦';
  const catId = document.getElementById('ai-cat').value;
  const type  = document.getElementById('ai-type').value;
  const price = document.getElementById('ai-price').value;
  const robux = document.getElementById('ai-robux').value;
  const sub   = document.getElementById('ai-sub')?.value;
  if (!id || !name || !catId) return toast('ID, Nama, Kategori wajib diisi', 'error');
  try {
    await post('/api/items', { id, name, emoji, categoryId: catId, type: type||undefined, price: price||0, robuxAmount: robux||undefined, subCategory: sub||undefined });
    toast(`✅ Item "${name}" berhasil ditambahkan!`);
    closeModal();
    loadItems();
    if (catId === 'gift_in_game') loadGig();
  } catch (err) { toast('Gagal tambah item: ' + err.message, 'error'); }
}

function showEditItemModal(id, name, item) {
  showModal(`✏️ Edit: ${name}`, `
    <div class="form-group"><label>Emoji</label><input id="ei-emoji" value="${item.emoji||'📦'}"></div>
    <div class="form-group"><label>Nama</label><input id="ei-name" value="${item.name}"></div>
    ${item.type==='gig'
      ? `<div class="form-group"><label>Jumlah Robux (©)</label><input id="ei-robux" type="number" value="${item.robuxAmount||0}"></div>`
      : `<div class="form-group"><label>Harga (Rp)</label><input id="ei-price" type="number" value="${item.price||0}"></div>`
    }
    <div class="modal-actions">
      <button class="btn btn-success" onclick="doEditItem('${id}',${item.type==='gig'})">💾 Simpan</button>
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
    </div>`);
}

async function doEditItem(id, isGig) {
  const name  = document.getElementById('ei-name').value.trim();
  const emoji = document.getElementById('ei-emoji').value.trim();
  const upd = { name, emoji };
  if (isGig) upd.robuxAmount = parseInt(document.getElementById('ei-robux').value)||0;
  else upd.price = parseInt(document.getElementById('ei-price').value)||0;
  try {
    await patch(`/api/items/${id}`, upd);
    toast('✅ Item diperbarui');
    closeModal();
    loadItems();
    loadGig();
  } catch (err) { toast('Gagal edit: ' + err.message, 'error'); }
}

// ── Categories ────────────────────────────────────────────────────────────────
async function loadCategories() {
  try {
    const cats = await get('/api/categories');
    document.getElementById('categories-grid').innerHTML = cats.map(c => `
      <div class="cat-card">
        <div class="cat-card-header">
          <div class="cat-name">${c.emoji} ${c.name}</div>
          <span class="badge ${c.isOpen?'badge-open':'badge-closed'}">${c.isOpen?'🟢 OPEN':'🔴 CLOSED'}</span>
        </div>
        <div class="cat-stats">📦 ${c.itemCount} item &nbsp;|&nbsp; 🔢 Stock: ${c.totalStock}</div>
        <div class="cat-actions">
          <button class="btn btn-xs ${c.isOpen?'btn-danger':'btn-success'}" onclick="toggleCategory('${c.id}',${!c.isOpen})">
            ${c.isOpen?'🔴 Tutup':'🟢 Buka'}
          </button>
        </div>
      </div>`).join('');
  } catch (err) { toast('Gagal load kategori: ' + err.message, 'error'); }
}

async function toggleCategory(id, isOpen) {
  try { await patch(`/api/categories/${id}`, { isOpen }); toast(`✅ Kategori ${isOpen?'dibuka':'ditutup'}`); loadCategories(); }
  catch (err) { toast('Gagal toggle: ' + err.message, 'error'); }
}

// ── Stock ─────────────────────────────────────────────────────────────────────
async function loadStock() {
  try { _stockData = await get('/api/stock'); renderStockTable(_stockData); }
  catch (err) { toast('Gagal load stock: ' + err.message, 'error'); }
}

function filterStockTable() {
  const q = (document.getElementById('stock-search')?.value||'').toLowerCase();
  renderStockTable(_stockData.filter(i => i.name.toLowerCase().includes(q) || (i.categoryId||'').toLowerCase().includes(q)));
}

function renderStockTable(items) {
  const out = items.filter(i => i.stock===0).length;
  const low = items.filter(i => i.stock>0&&i.stock<=5).length;
  document.getElementById('stock-table').innerHTML =
    `<div style="display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px">
      <span class="color-danger">❌ Habis: ${out}</span>
      <span class="color-warning">⚠️ Low: ${low}</span>
      <span class="color-success">✅ OK: ${items.length-out-low}</span>
    </div>` + (items.length===0
      ? `<div class="empty-state"><div class="emoji">📦</div>Kosong</div>`
      : `<div class="table-wrap"><table>
        <thead><tr><th></th><th>Nama</th><th>Kategori</th><th>Harga</th><th>Stock</th><th>Update</th></tr></thead>
        <tbody>${items.map(i => {
          const cls = i.stock===0?'color-danger':i.stock<=5?'color-warning':'color-success';
          return `<tr>
            <td>${i.emoji||'📦'}</td><td>${i.name}</td>
            <td class="color-muted">${i.categoryId||'—'}</td>
            <td>${i.type==='gig'?`©${i.robuxAmount}`:rp(i.effectivePrice||0)}</td>
            <td class="${cls}"><b>${i.stock}</b></td>
            <td><div class="inline-edit">
              <input type="number" id="stk-${i.id}" value="${i.stock}" min="0">
              <button class="btn btn-xs btn-success" onclick="saveStock('${i.id}')">💾</button>
            </div></td>
          </tr>`;
        }).join('')}</tbody></table></div>`);
}

async function saveStock(itemId) {
  const input = document.getElementById(`stk-${itemId}`);
  const amount = parseInt(input?.value);
  if (isNaN(amount)||amount<0) return toast('Stock tidak valid', 'error');
  try { await patch(`/api/items/${itemId}/stock`, { amount }); toast('✅ Stock diperbarui'); }
  catch (err) { toast('Gagal update: ' + err.message, 'error'); }
}

function showBulkStockModal() {
  const items = _stockData.slice(0, 5).map(i => `${i.id}:${i.stock}`).join('\n');
  showModal('📋 Bulk Update Stock', `
    <p style="color:var(--text2);font-size:13px;margin-bottom:12px">Format: satu baris per item <code style="background:var(--bg3);padding:2px 6px;border-radius:4px">ID_ITEM:JUMLAH</code></p>
    <div class="form-group">
      <label>Data Stock (ID:Jumlah)</label>
      <textarea id="bulk-stock-data" rows="8" placeholder="ff_diamond_100:50\nff_diamond_210:30\n...">${items}</textarea>
    </div>
    <div class="form-group">
      <label>Mode</label>
      <select id="bulk-mode">
        <option value="set">Set (ganti dengan nilai baru)</option>
        <option value="add">Add (tambahkan ke existing)</option>
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-warning" onclick="doBulkStock()">📋 Update Semua</button>
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
    </div>`);
}

async function doBulkStock() {
  const raw  = document.getElementById('bulk-stock-data').value.trim();
  const mode = document.getElementById('bulk-mode').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const updates = lines.map(l => {
    const [id, amount] = l.split(':');
    return { id: id?.trim(), amount: parseInt(amount)||0, mode };
  }).filter(u => u.id && !isNaN(u.amount));
  if (updates.length === 0) return toast('Format tidak valid', 'error');
  try {
    await post('/api/stock/bulk', { updates });
    toast(`✅ ${updates.length} item diupdate`);
    closeModal();
    loadStock();
  } catch (err) { toast('Gagal bulk update: ' + err.message, 'error'); }
}

// ── Vouchers ──────────────────────────────────────────────────────────────────
async function loadVouchers() {
  try {
    const vouchers = await get('/api/vouchers');
    if (vouchers.length === 0) {
      document.getElementById('vouchers-grid').innerHTML = `<div class="empty-state"><div class="emoji">🎫</div>Belum ada voucher. Klik "Buat Voucher" untuk mulai!</div>`;
      return;
    }
    const now = new Date();
    document.getElementById('vouchers-grid').innerHTML = vouchers.map((v,idx) => {
      const expired = v.expiry && new Date(v.expiry) < now;
      const cls = !v.active ? 'inactive' : expired ? 'expired' : '';
      const discStr = v.type === 'percent' ? `${v.value}% OFF` : `${rp(v.value)} OFF`;
      const used = `${v.usedCount||0}/${v.maxUses===-1||v.maxUses===-1?'∞':v.maxUses}`;
      return `<div class="voucher-card ${cls}">
        <div class="voucher-code">${v.code}</div>
        <div class="voucher-disc">${discStr}</div>
        <div class="voucher-meta">
          <span>📊 Dipakai: ${used}</span>
          <span>⏳ Exp: ${v.expiry ? new Date(v.expiry).toLocaleDateString('id-ID') : 'Selamanya'}</span>
          <span>👤 By: ${v.createdBy||'—'}</span>
          <span>${v.active&&!expired ? '<span class="badge badge-active">🟢 Aktif</span>' : '<span class="badge badge-inactive">🔴 Nonaktif</span>'}</span>
        </div>
        <div class="voucher-actions">
          <button class="btn btn-xs ${v.active?'btn-warning':'btn-success'}" onclick="toggleVoucher('${v.code}',${!v.active})">${v.active?'🔴 Nonaktifkan':'🟢 Aktifkan'}</button>
          <button class="btn btn-xs btn-danger" onclick="deleteVoucher('${v.code}')">🗑 Hapus</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) { toast('Gagal load vouchers: ' + err.message, 'error'); }
}

function showCreateVoucherModal() {
  showModal('🎫 Buat Voucher Baru', `
    <div class="form-group"><label>Kode Voucher</label><input id="vc-code" placeholder="DISKON50" style="text-transform:uppercase"></div>
    <div class="form-group"><label>Tipe Diskon</label>
      <select id="vc-type">
        <option value="percent">Persen (%) — contoh: 10% off</option>
        <option value="fixed">Nominal (Rp) — contoh: Rp 5.000 off</option>
      </select>
    </div>
    <div class="form-group"><label>Nilai Diskon</label><input id="vc-value" type="number" min="1" placeholder="10"></div>
    <div class="form-group"><label>Maks Penggunaan (-1 = unlimited)</label><input id="vc-maxuses" type="number" value="-1"></div>
    <div class="form-group"><label>Tanggal Kedaluarsa (opsional)</label><input id="vc-expiry" type="date"></div>
    <div class="modal-actions">
      <button class="btn btn-success" onclick="doCreateVoucher()">✅ Buat Voucher</button>
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
    </div>`);
}

async function doCreateVoucher() {
  const code    = document.getElementById('vc-code').value.trim().toUpperCase();
  const type    = document.getElementById('vc-type').value;
  const value   = parseFloat(document.getElementById('vc-value').value);
  const maxUses = parseInt(document.getElementById('vc-maxuses').value);
  const expiry  = document.getElementById('vc-expiry').value || null;
  if (!code || !type || !value) return toast('Kode, tipe, dan nilai wajib diisi', 'error');
  if (type==='percent' && value>100) return toast('Persen maksimal 100%', 'error');
  try {
    await post('/api/vouchers', { code, type, value, maxUses: isNaN(maxUses)?-1:maxUses, expiry: expiry||null });
    toast(`✅ Voucher "${code}" berhasil dibuat!`);
    closeModal();
    loadVouchers();
  } catch (err) { toast('Gagal buat voucher: ' + err.message, 'error'); }
}

async function toggleVoucher(code, active) {
  try { await patch(`/api/vouchers/${code}`, { active }); toast(`✅ Voucher ${active?'diaktifkan':'dinonaktifkan'}`); loadVouchers(); }
  catch (err) { toast('Gagal toggle: ' + err.message, 'error'); }
}

async function deleteVoucher(code) {
  if (!confirm(`Hapus voucher "${code}"?`)) return;
  try { await del(`/api/vouchers/${code}`); toast(`🗑 Voucher "${code}" dihapus`); loadVouchers(); }
  catch (err) { toast('Gagal hapus: ' + err.message, 'error'); }
}

// ── Reviews ───────────────────────────────────────────────────────────────────
async function loadReviews() {
  try {
    const reviews = await get('/api/reviews');
    if (reviews.length === 0) {
      document.getElementById('reviews-summary').innerHTML = '';
      document.getElementById('reviews-grid').innerHTML = `<div class="empty-state"><div class="emoji">⭐</div>Belum ada review</div>`;
      return;
    }
    const avg = reviews.reduce((s,r) => s+(r.rating||0), 0) / reviews.length;
    const dist = [5,4,3,2,1].map(n => ({ n, count: reviews.filter(r => (r.rating||0)===n).length }));
    document.getElementById('reviews-summary').innerHTML = `
      <div class="review-stat-card">
        <div class="review-big-num">${avg.toFixed(1)}</div>
        <div>${starDisplay(Math.round(avg))}</div>
        <div class="review-big-sub">Rating Rata-rata</div>
      </div>
      <div class="review-stat-card">
        <div class="review-big-num">${reviews.length}</div>
        <div class="review-big-sub">Total Review</div>
      </div>
      ${dist.map(d => `<div class="review-stat-card" style="min-width:80px">
        <div class="review-big-num" style="font-size:20px">${d.n}⭐</div>
        <div class="review-big-sub">${d.count}x</div>
      </div>`).join('')}`;

    document.getElementById('reviews-grid').innerHTML = reviews.slice().reverse().map((r,i) => `
      <div class="review-card">
        <div class="review-header">
          <div>
            <div class="review-user">👤 ${r.username||'Anonim'}</div>
            <div class="review-stars">${starDisplay(r.rating)}</div>
          </div>
          <button class="btn btn-xs btn-danger" onclick="deleteReview(${reviews.length-1-i})">🗑</button>
        </div>
        <div class="review-text">${r.comment||r.text||'—'}</div>
        <div class="review-footer">
          <span class="td-mono" style="font-size:11px">${r.invoice||'—'}</span>
          <span>${dtShort(r.date||r.createdAt)}</span>
        </div>
      </div>`).join('');
  } catch (err) { toast('Gagal load reviews: ' + err.message, 'error'); }
}

async function deleteReview(idx) {
  if (!confirm('Hapus review ini?')) return;
  try { await del(`/api/reviews/${idx}`); toast('🗑 Review dihapus'); loadReviews(); }
  catch (err) { toast('Gagal hapus: ' + err.message, 'error'); }
}

async function clearAllReviews() {
  if (!confirm('Hapus SEMUA review? Tidak bisa dikembalikan!')) return;
  try { await del('/api/reviews'); toast('🗑 Semua review dihapus'); loadReviews(); }
  catch (err) { toast('Gagal hapus: ' + err.message, 'error'); }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await get('/api/settings');
    document.getElementById('set-gig-rate').value    = s.gigRate||86;
    document.getElementById('set-robux-rate').value  = s.robuxRate||145;
    document.getElementById('set-dana-number').value = s.danaNumber||'';
    document.getElementById('set-dana-name').value   = s.danaName||'';
    document.getElementById('set-maintenance').checked = s.maintenance||false;
    document.getElementById('set-antispam').checked  = s.antiSpam!==false;
    document.getElementById('set-autodm').checked    = s.autoDmEnabled!==false;
    document.getElementById('set-max-order').value   = s.maxOrderPerUser||5;
    document.getElementById('set-low-stock').value   = s.lowStockThreshold||3;
  } catch (err) { toast('Gagal load settings: ' + err.message, 'error'); }
}

async function saveRates() {
  const gigRate   = parseInt(document.getElementById('set-gig-rate').value);
  const robuxRate = parseInt(document.getElementById('set-robux-rate').value);
  if (!gigRate||!robuxRate) return toast('Rate tidak valid', 'error');
  try { await patch('/api/settings', { gigRate, robuxRate }); toast('✅ Rate berhasil disimpan'); }
  catch (err) { toast('Gagal: ' + err.message, 'error'); }
}

async function saveDana() {
  const danaNumber = document.getElementById('set-dana-number').value.trim();
  const danaName   = document.getElementById('set-dana-name').value.trim();
  if (!danaNumber||!danaName) return toast('Isi nomor & nama DANA', 'error');
  try { await patch('/api/settings', { danaNumber, danaName }); toast('✅ Info DANA berhasil disimpan'); }
  catch (err) { toast('Gagal: ' + err.message, 'error'); }
}

async function saveSettings() {
  const maintenance    = document.getElementById('set-maintenance').checked;
  const antiSpam       = document.getElementById('set-antispam').checked;
  const autoDmEnabled  = document.getElementById('set-autodm').checked;
  const maxOrderPerUser = parseInt(document.getElementById('set-max-order').value)||5;
  const lowStockThreshold = parseInt(document.getElementById('set-low-stock').value)||3;
  try { await patch('/api/settings', { maintenance, antiSpam, autoDmEnabled, maxOrderPerUser, lowStockThreshold }); toast('✅ Settings disimpan'); }
  catch (err) { toast('Gagal: ' + err.message, 'error'); }
}

async function changePassword() {
  const pw1 = document.getElementById('set-new-pass').value;
  const pw2 = document.getElementById('set-confirm-pass').value;
  if (!pw1||pw1.length<6) return toast('Password min 6 karakter', 'error');
  if (pw1 !== pw2) return toast('Password tidak cocok!', 'error');
  try {
    await post('/api/settings/password', { newPassword: pw1 });
    toast('✅ Password berhasil diubah! Silakan login ulang.', 'success');
    document.getElementById('set-new-pass').value = '';
    document.getElementById('set-confirm-pass').value = '';
  } catch (err) { toast('Gagal: ' + err.message, 'error'); }
}

async function userLookup() {
  const userId = document.getElementById('set-user-lookup').value.trim();
  if (!userId) return toast('Masukkan User ID', 'error');
  try {
    const u = await get(`/api/users/${userId}`);
    const recentOrders = (u.orders||[]).slice(0,3).map(o =>
      `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">${o.invoice} — ${(o.itemName||'').substring(0,20)} — ${statusBadge(o.status)}</div>`
    ).join('');
    document.getElementById('user-lookup-result').innerHTML = `
      <div class="user-lookup-card">
        <div class="row"><span>User ID</span><span class="td-mono">${u.userId}</span></div>
        <div class="row"><span>Total Order</span><span>${u.totalOrders}</span></div>
        <div class="row"><span>Order Selesai</span><span>${u.doneOrders}</span></div>
        <div class="row"><span>Total Spent</span><span class="color-gold">${rp(u.totalSpent)}</span></div>
        <div class="row"><span>Status</span><span>${u.banned?'<span class="badge badge-cancelled">🔨 BANNED</span>':'<span class="badge badge-open">✅ OK</span>'}</span></div>
        ${u.banned?`<div class="row"><span>Alasan Ban</span><span>${u.banInfo?.reason||'—'}</span></div>`:''}
        ${recentOrders?`<div style="margin-top:8px;font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;margin-bottom:4px">Order Terbaru</div>${recentOrders}`:''}
        <div style="margin-top:10px;display:flex;gap:8px">
          ${u.banned
            ? `<button class="btn btn-xs btn-success" onclick="doUnbanUser('${u.userId}')">✅ Unban</button>`
            : `<button class="btn btn-xs btn-danger" onclick="doBanUserFromLookup('${u.userId}')">🔨 Ban</button>`
          }
        </div>
      </div>`;
  } catch (err) { toast('User tidak ditemukan: ' + err.message, 'error'); }
}

async function doUnbanUser(userId) {
  try { await del(`/api/bans/${userId}`); toast('✅ User di-unban'); userLookup(); }
  catch (err) { toast('Gagal unban: ' + err.message, 'error'); }
}

async function doBanUserFromLookup(userId) {
  const reason = prompt('Alasan ban:') || 'Banned via web admin';
  try { await post('/api/bans', { userId, reason }); toast('🔨 User di-ban'); userLookup(); }
  catch (err) { toast('Gagal ban: ' + err.message, 'error'); }
}

// ── Bans ──────────────────────────────────────────────────────────────────────
async function loadBans() {
  try {
    const bans = await get('/api/bans');
    document.getElementById('bans-table').innerHTML = bans.length === 0
      ? `<div class="empty-state"><div class="emoji">🔨</div>Tidak ada user yang di-ban</div>`
      : `<div class="table-wrap"><table>
        <thead><tr><th>User ID</th><th>Alasan</th><th>Oleh</th><th>Tanggal</th><th>Aksi</th></tr></thead>
        <tbody>${bans.map(b => `<tr>
          <td class="td-mono">${b.userId}</td>
          <td>${b.reason||'—'}</td>
          <td class="color-muted">${b.bannedBy||'—'}</td>
          <td class="color-muted">${dtShort(b.date)}</td>
          <td><button class="btn btn-xs btn-success" onclick="unbanUser('${b.userId}')">✅ Unban</button></td>
        </tr>`).join('')}</tbody></table></div>`;
  } catch (err) { toast('Gagal load bans: ' + err.message, 'error'); }
}

async function unbanUser(userId) {
  try { await del(`/api/bans/${userId}`); toast('✅ User di-unban'); loadBans(); }
  catch (err) { toast('Gagal unban: ' + err.message, 'error'); }
}

function showBanModal() {
  showModal('🔨 Ban User', `
    <div class="form-group"><label>Discord User ID</label><input id="ban-uid" placeholder="123456789..."></div>
    <div class="form-group"><label>Alasan</label><input id="ban-reason" placeholder="Scammer / spam / dll"></div>
    <div class="modal-actions">
      <button class="btn btn-danger" onclick="doBanUser()">🔨 Ban User</button>
      <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
    </div>`);
}

async function doBanUser() {
  const userId = document.getElementById('ban-uid').value.trim();
  const reason = document.getElementById('ban-reason').value.trim();
  if (!userId) return toast('User ID wajib diisi', 'error');
  try { await post('/api/bans', { userId, reason }); toast(`🔨 User ${userId} di-ban`); closeModal(); loadBans(); }
  catch (err) { toast('Gagal ban: ' + err.message, 'error'); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
checkAuth();
