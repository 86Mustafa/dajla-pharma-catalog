// ===== أدوات صغيرة =====
const $ = s => document.querySelector(s);
const fmt = n => Number(n).toLocaleString('en-US');
const digits = s => String(s).replace(/\D/g, '');
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
const load = async url => { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); };
const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#f0f0f0"/></svg>');

// ===== الحالة (State): مصدر الحقيقة الوحيد =====
let cfg = {}, products = [], cat = 'all', q = '';
let cart = JSON.parse(localStorage.getItem('cart_v1') || '{}');   // { productId: qty }
const money = n => fmt(n) + ' ' + (cfg.currency || '');
const byId = id => products.find(p => p.id === id);
const label = t => (cfg.categories && cfg.categories[t]) || t;

function saveCart() { localStorage.setItem('cart_v1', JSON.stringify(cart)); }
function setQty(id, n) {
  n = Math.max(0, Math.min(cfg.maxQty || 999, Math.floor(Number(n) || 0)));
  if (n) cart[id] = n; else delete cart[id];
  saveCart(); render();
}
function clearCart() { cart = {}; saveCart(); render(); }
function totals() {
  let t = 0, c = 0;
  for (const id in cart) { const p = byId(id); if (p) { t += p.price * cart[id]; c += cart[id]; } }
  return { t, c };
}

// ===== مكوّنات الواجهة =====
function stepper(id) {
  const i = el('input', { type: 'number', min: 0, step: 1, value: cart[id] || 0, onchange: () => setQty(id, i.value) });
  i.dataset.id = id;
  return el('div', { className: 'step' },
    el('button', { type: 'button', textContent: '−', onclick: () => setQty(id, (cart[id] || 0) - 1) }), i,
    el('button', { type: 'button', textContent: '+', onclick: () => setQty(id, (cart[id] || 0) + 1) }));
}
function imgSrc(p) { return 'images/' + encodeURI(p.image || ''); }
function zoom(p) { $('#zimg').src = imgSrc(p); $('#zname').textContent = p.name; $('#zoom').classList.add('open'); }

function drawChips() {
  const c = $('#chips'); c.replaceChildren();
  for (const t of ['all', ...new Set(products.map(p => p.type))])
    c.append(el('button', { className: 'chip' + (t === cat ? ' on' : ''), textContent: t === 'all' ? 'الكل' : label(t),
      onclick: () => { cat = t; drawChips(); drawGrid(); } }));
}
function drawGrid() {
  const g = $('#grid'); g.replaceChildren();
  const list = products.filter(p => (cat === 'all' || p.type === cat) && p.name.toLowerCase().includes(q));
  $('#status').textContent = list.length ? '' : 'لا توجد نتائج';
  for (const p of list) {
    const img = el('img', { loading: 'lazy', alt: p.name, src: imgSrc(p), onclick: () => zoom(p), onerror() { this.onerror = null; this.src = PH; } });
    g.append(el('article', { className: 'card' + (p.disabled ? ' off' : '') }, img,
      el('div', { className: 'name', textContent: p.name }),
      el('div', { className: 'type', textContent: label(p.type) }),
      el('div', { className: 'price', textContent: money(p.price) }),
      p.disabled ? el('div', { className: 'type', textContent: 'غير متوفر' }) : stepper(p.id)));
  }
}
// يحدّث كل شيء من الحالة (السلة) فقط
function render() {
  document.querySelectorAll('input[data-id]').forEach(i => { const v = cart[i.dataset.id] || 0; if (+i.value !== v) i.value = v; });
  const { t, c } = totals();
  const b = $('#cartBtn'); b.hidden = !c; b.textContent = `🛒 ${c} • ${money(t)} • إكمال الطلب`;
  $('#total').textContent = money(t);
  const L = $('#lines'); L.replaceChildren();
  for (const id in cart) {
    const p = byId(id); if (!p) continue;
    L.append(el('div', { className: 'line' }, el('div', { className: 'n', textContent: p.name }), stepper(id),
      el('div', { className: 's', textContent: fmt(p.price * cart[id]) }),
      el('button', { className: 'x2', textContent: '🗑', title: 'حذف', onclick: () => setQty(id, 0) })));
  }
  if (!c) $('#panel').classList.remove('open');
}

// ===== نموذج العميل (يُبنى من config.json ويحفظ بياناته) =====
function buildForm() {
  const saved = JSON.parse(localStorage.getItem('cust_v1') || '{}');
  const f = $('#form');
  for (const d of cfg.customerFields) {
    const props = { id: 'f_' + d.id, placeholder: d.label, value: saved[d.id] || '',
      oninput: e => { saved[d.id] = e.target.value; localStorage.setItem('cust_v1', JSON.stringify(saved)); } };
    if (d.type !== 'textarea') props.type = d.type || 'text';
    f.append(el(d.type === 'textarea' ? 'textarea' : 'input', props));
  }
  f.append(
    el('button', { type: 'button', className: 'btn', textContent: 'إرسال الطلب عبر واتساب', onclick: sendOrder }),
    el('button', { type: 'button', className: 'btn sec', textContent: 'تفريغ السلة', onclick: () => confirm('تفريغ السلة؟') && clearCart() }),
    el('p', { id: 'hint', className: 'hint' }));
}

// ===== إرسال الطلب =====
function sendOrder() {
  const { t, c } = totals();
  if (!c) return alert('السلة فارغة');
  const v = {};
  for (const d of cfg.customerFields) {
    v[d.id] = $('#f_' + d.id).value.trim();
    if (d.required && !v[d.id]) return alert('الرجاء إدخال: ' + d.label);
  }
  if (v.phone && cfg.phonePattern) {
    const n = digits(v.phone).replace(new RegExp('^(00)?' + (cfg.countryCode || '')), '').replace(/^0/, '');
    if (!new RegExp(cfg.phonePattern).test(n)) return alert('رقم الهاتف غير صحيح');
  }
  const items = Object.keys(cart).filter(byId).map((k, i) => {
    const p = byId(k), n = cart[k];
    return `${i + 1}. *${p.name}*\n   ${n} × ${fmt(p.price)} = ${money(p.price * n)}`;
  }).join('\n');
  const customer = cfg.customerFields.map(d => v[d.id] && `${d.label}: ${v[d.id]}`).filter(Boolean).join('\n');
  const m = { brand: cfg.brand.name, date: new Date().toLocaleString('ar-IQ'), orderId: Date.now().toString().slice(-6), items, total: money(t), customer };
  const msg = cfg.messageTemplate.replace(/\{(\w+)\}/g, (_, k) => m[k] ?? '');
  const url = `https://wa.me/${digits(cfg.whatsapp)}?text=${encodeURIComponent(msg)}`;
  if (!window.open(url, '_blank')) location.href = url;
  // لا نفرّغ السلة تلقائياً: قد لا يضغط المستخدم "إرسال" داخل واتساب
  $('#hint').textContent = 'بعد إرسال الرسالة في واتساب اضغط "تفريغ السلة". إن لم تُرسل بعد، سلتك محفوظة.';
}

// ===== التشغيل =====
async function init() {
  try { [cfg, products] = await Promise.all([load('config.json'), load('products.json')]); }
  catch (e) { $('#status').textContent = 'تعذر تحميل البيانات'; return; }
  const seen = new Set();
  products.forEach((p, i) => {   // معرّف ثابت لكل منتج (لا يتغير بتغيّر الترتيب)
    p.name = p.name.trim();
    let id = p.id || [p.name.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '-'), p.type, p.price].join('_');
    if (seen.has(id)) id += '_' + i;
    seen.add(id); p.id = id; p.price = Number(p.price);
  });
  for (const k in cart) if (!byId(k)) delete cart[k];
  document.title = cfg.brand.name;
  document.documentElement.style.setProperty('--brand', cfg.brand.color);
  $('#brand').textContent = cfg.brand.name; $('#tagline').textContent = cfg.brand.tagline || '';
  if (cfg.brand.logo) { $('#logo').src = cfg.brand.logo; $('#logo').hidden = false; }
  buildForm(); drawChips(); drawGrid(); render();

  $('#search').oninput = e => { q = e.target.value.trim().toLowerCase(); drawGrid(); };
  $('#cartBtn').onclick = () => $('#panel').classList.add('open');
  $('#closePanel').onclick = () => $('#panel').classList.remove('open');
  $('#panel').onclick = e => { if (e.target.id === 'panel') $('#panel').classList.remove('open'); };
  $('#zoom').onclick = () => $('#zoom').classList.remove('open');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.open').forEach(x => x.classList.remove('open')); });

  load('offers.json').then(d => {   // العروض اختيارية
    const o = (d.offers || []).filter(x => x.content); if (!o.length) return;
    const b = $('#offer'); let i = 0;
    const show = () => { b.hidden = false; b.textContent = '🎁 ' + (o[i].title ? o[i].title + ': ' : '') + o[i].content; i = (i + 1) % o.length; };
    show(); if (o.length > 1) setInterval(show, 5000);
  }).catch(() => {});
}
init();
