'use strict';
// ===== أدوات صغيرة =====
const $ = s => document.querySelector(s);
const fmt = n => Number(n).toLocaleString('en-US');
const digits = s => String(s).replace(/\D/g, '');
const el = (tag, props = {}, ...kids) => {
  const { attrs, ...rest } = props, e = document.createElement(tag);
  Object.assign(e, rest);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  e.append(...kids.filter(k => k != null && k !== false));
  return e;
};
const load = async url => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(url); return r.json(); };
const ls = {   // تخزين آمن (لا يتعطل التطبيق إذا كان التخزين محظوراً)
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const IC = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M10 20v-5h4v5"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0L8 7m4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.9L2 22l5.27-1.38A9.9 9.9 0 1 0 12.04 2zm5.8 14.1c-.25.7-1.45 1.33-2 1.4-.52.07-1.17.1-1.9-.12-.44-.14-1-.32-1.73-.63-3.04-1.3-5-4.37-5.15-4.57-.15-.2-1.23-1.63-1.23-3.1s.78-2.2 1.05-2.5c.28-.3.6-.37.8-.37h.58c.18 0 .43-.07.67.52.25.6.85 2.07.92 2.22.08.15.13.32.03.52-.1.2-.15.32-.3.5-.15.17-.31.38-.44.5-.15.15-.3.31-.13.6.18.3.77 1.27 1.65 2.05 1.13 1 2.08 1.32 2.38 1.47.3.15.47.12.65-.07.17-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.28.1 1.75.83 2.05.98.3.15.5.22.57.35.08.12.08.72-.17 1.42z"/></svg>'
};
const TYPE_IC = { tab: '💊', cream: '🧴', ointment: '🩹', syrup: '🥄', susp: '🧪', drop: '💧' };
const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#e6f3ee"/><g transform="rotate(-35 60 60)"><rect x="28" y="45" width="64" height="30" rx="15" fill="#fff" stroke="#9fd3c0" stroke-width="3"/><path d="M60 45h17a15 15 0 0 1 0 30H60z" fill="#9fd3c0"/></g></svg>');

// ===== الحالة (State): مصدر الحقيقة الوحيد =====
let cfg = {}, products = [], offers = { offers: [], tiers: [] }, cat = 'all', q = '', priceMap = {}, cur = '';
let cart = ls.get('cart_v2', {});          // { productId: qty }
const cards = new Map();                    // productId -> { card, act }
const money = n => fmt(n) + ' ' + (cfg.currency || '');
const byId = id => products.find(p => p.id === id);
const label = t => (cfg.categories && cfg.categories[t]) || t;

// ===== قوائم الأسعار حسب المذخر/المورد (نفس منطق النسخة السابقة) =====
const norm = s => String(s).toLowerCase().replace(/[\s\-–—_/().]+/g, '');
const lists = () => cfg.priceLists || [];
const curList = () => lists().find(l => l.id === cur) || {};
function priceOf(p) {   // السعر حسب المذخر المختار، و null = غير متوفر لديه
  const m = priceMap[cur] || {};
  const o = m[norm(p.name) + '::' + p.type] ?? m[norm(p.name)];
  if (o != null) return Number(o);
  return curList().strict ? null : p.price;
}
const avail = p => !p.disabled && priceOf(p) != null;

// اسم العرض: ننظّف الاسم ونفصل وسم (باكيت / بدون) — الاسم الأصلي يبقى للرسالة والأسعار
function prettify(p) {
  let n = p.name.trim(), tag = '';
  const m = n.match(/[\s(]*(باكيت|بدون)[\s)]*$/);
  if (m) { tag = m[1]; n = n.slice(0, m.index); }
  n = n.replace(/\s*\/\s*/g, ' ').replace(/[\s(]+$/, '').replace(/\s+/g, ' ').trim();
  p.disp = n || p.name; p.tag = tag;
}

// ===== السلة =====
const saveCart = () => ls.set('cart_v2', cart);
function setQty(id, n) {
  n = Math.max(0, Math.min(cfg.maxQty || 999, Math.floor(Number(n) || 0)));
  if (n) cart[id] = n; else delete cart[id];
  saveCart(); syncCard(id); renderCart(); renderReorder();
  if (zoomId === id) fillZoomAct();
}
function setCart(next, silent) { cart = next; saveCart(); cards.forEach((_, id) => syncCard(id)); renderCart(); renderReorder(); }
function totals() {
  let t = 0, c = 0, n = 0, miss = 0;
  for (const id in cart) {
    const p = byId(id); if (!p) continue;
    if (avail(p)) { t += priceOf(p) * cart[id]; c += cart[id]; n++; } else miss++;
  }
  return { t, c, n, miss };
}
// مستويات البونص (من offers.json → tiers)
function tierState(t) {
  const T = (offers.tiers || []).filter(x => x.at > 0).sort((a, b) => a.at - b.at);
  if (!T.length || !t) return null;
  const reached = [...T].reverse().find(x => t >= x.at), next = T.find(x => t < x.at);
  if (!next) return { pct: 100, short: '🎉 حققت أعلى مستوى من البونص', long: '🎉 ' + reached.label + ' — أعلى مستوى!' };
  return {
    pct: Math.min(100, Math.round(t / next.at * 100)),
    short: `باقي ${money(next.at - t)} للبونص التالي`,
    long: (reached ? '✅ ' + reached.label + '\n' : '') + `باقي ${money(next.at - t)} للوصول إلى: ${next.label}`
  };
}

// ===== مكوّنات الواجهة =====
const thumb = p => 'thumbs/' + encodeURI(p.image || '');
const full = p => 'images/' + encodeURI(p.image || '');
function picture(p, src, props = {}) {
  const img = el('img', { alt: p.name, src, decoding: 'async', ...props });
  img.onerror = () => { if (!img.dataset.f && src !== full(p)) { img.dataset.f = 1; img.src = full(p); } else { img.onerror = null; img.src = PH; } };
  return img;
}
function stepper(id) {
  const i = el('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', value: cart[id] || 0, attrs: { 'aria-label': 'الكمية' },
    onchange: () => setQty(id, i.value), onfocus: () => i.select() });
  return el('div', { className: 'step' },
    el('button', { type: 'button', textContent: '+', attrs: { 'aria-label': 'زيادة' }, onclick: () => { setQty(id, (cart[id] || 0) + 1); if (navigator.vibrate) navigator.vibrate(8); } }), i,
    el('button', { type: 'button', textContent: '−', attrs: { 'aria-label': 'إنقاص' }, onclick: () => setQty(id, (cart[id] || 0) - 1) }));
}
function actFor(p) {   // زر "إضافة" ← يتحول إلى عدّاد
  if (!avail(p)) return el('span', { className: 'na', textContent: p.disabled ? 'غير متوفر' : 'غير متوفر لدى هذا المذخر' });
  if (!cart[p.id]) {
    const b = el('button', { type: 'button', className: 'add', onclick: () => { setQty(p.id, 1); if (navigator.vibrate) navigator.vibrate(8); } });
    b.innerHTML = IC.plus + '<span>إضافة</span>';
    return b;
  }
  return stepper(p.id);
}
function syncCard(id) {
  const c = cards.get(id), p = byId(id); if (!c || !p) return;
  c.act.replaceChildren(actFor(p));
  c.card.classList.toggle('in', !!cart[id]);
}
function priceNode(p) {
  const pr = priceOf(p);
  return el('div', { className: 'price' }, pr == null ? '—' : el('b', { textContent: fmt(pr) }), pr == null ? null : el('small', { textContent: cfg.currency || '' }));
}
function buildCard(p) {
  const act = el('div', { className: 'act' });
  const box = el('button', { type: 'button', className: 'imgbox', onclick: () => openZoom(p), attrs: { 'aria-label': 'عرض صورة ' + p.name } },
    picture(p, thumb(p), { loading: 'lazy' }), p.tag && el('span', { className: 'tag', textContent: p.tag }));
  const card = el('article', { className: 'card' + (avail(p) ? '' : ' off') + (cart[p.id] ? ' in' : '') }, box,
    el('div', { className: 'body' },
      el('h3', { className: 'name', textContent: p.disp, title: p.name }),
      el('div', { className: 'type', textContent: (TYPE_IC[p.type] || '📦') + ' ' + label(p.type) }),
      priceNode(p), act));
  cards.set(p.id, { card, act });
  act.append(actFor(p));
  return card;
}

function drawSeg() {
  const L = lists(); if (L.length < 2) return;
  const s = $('#seg'); s.replaceChildren();
  for (const l of L) s.append(el('button', { type: 'button', textContent: l.name, attrs: { role: 'radio', 'aria-checked': String(l.id === cur) },
    onclick: () => {
      if (cur === l.id) return;
      cur = l.id; ls.set('list_v2', cur); drawSeg(); drawGrid(); renderCart();
      const { miss } = totals();
      toast(miss ? `تم التحويل إلى ${l.name} — ${miss} صنف غير متوفر لديه` : `تم التحويل إلى مذخر ${l.name}`);
    } }));
}
function drawChips() {
  const c = $('#chips'); c.replaceChildren();
  const count = {}; products.forEach(p => count[p.type] = (count[p.type] || 0) + 1);
  for (const t of ['all', ...Object.keys(count)])
    c.append(el('button', { type: 'button', className: 'chip' + (t === cat ? ' on' : ''),
      onclick: e => { cat = t; drawChips(); drawGrid(); $('#chips .on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); } },
      t === 'all' ? '✨ الكل' : (TYPE_IC[t] || '📦') + ' ' + label(t), el('small', { textContent: t === 'all' ? products.length : count[t] })));
}
function drawGrid() {
  const g = $('#grid'); g.replaceChildren(); cards.clear();
  const words = norm(q) ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];
  const list = products
    .filter(p => (cat === 'all' || p.type === cat) && words.every(w => (p.name + ' ' + label(p.type) + ' ' + p.tag).toLowerCase().includes(w)))
    .sort((a, b) => avail(b) - avail(a));   // المتوفر أولاً (الترتيب الأصلي محفوظ داخل كل مجموعة)
  const st = $('#status'); st.replaceChildren();
  if (!list.length) st.append(q ? `لا توجد نتائج لـ «${q}»` : 'لا توجد أصناف', q && el('button', { type: 'button', textContent: 'مسح البحث', onclick: () => { q = ''; $('#search').value = ''; drawGrid(); } }));
  const frag = document.createDocumentFragment();
  list.forEach(p => frag.append(buildCard(p)));
  g.append(frag);
}

// ===== شريط السلة + نافذة المراجعة =====
function renderCart() {
  const { t, c, n, miss } = totals();
  const bar = $('#bar'); bar.hidden = !n && !miss;
  document.body.style.paddingBottom = '';
  $('#cnt').textContent = n; $('#sum').textContent = money(t);
  const ts = tierState(t), tier = $('#tier');
  tier.hidden = !ts; if (ts) { $('#tierTx').textContent = ts.short; $('#tierFill').style.width = ts.pct + '%'; }
  $('#total').textContent = money(t);
  $('#send').disabled = !n;
  if (layer === 'sheet') { renderLines(); if (!n && !miss) closeLayer(); }
}
function renderLines() {
  const { t, c, n, miss } = totals();
  $('#sheetSub').textContent = `${n} صنف · ${c} قطعة`;
  const L = $('#lines'); L.replaceChildren();
  for (const id in cart) {
    const p = byId(id); if (!p) continue;
    const ok = avail(p);
    L.append(el('div', { className: 'line' + (ok ? '' : ' gone') },
      picture(p, thumb(p), { width: 52, height: 52, loading: 'lazy' }),
      el('div', { className: 'n' }, p.disp, ok ? el('small', { textContent: `${money(priceOf(p))} للوحدة` }) : el('small', { textContent: p.tag || '' })),
      el('div', { className: 's', textContent: ok ? money(priceOf(p) * cart[id]) : 'غير متوفر لديه' }),
      ok ? stepper(id) : el('span'),
      el('button', { type: 'button', className: 'del', attrs: { 'aria-label': 'حذف' }, innerHTML: IC.trash, onclick: () => removeLine(id) })));
  }
  const w = $('#warn'); w.hidden = !miss;
  if (miss) w.textContent = `⚠️ ${miss} صنف في سلتك غير متوفر لدى المذخر الحالي ولن يُضاف للطلب.`;
  const ts = tierState(t), t2 = $('#tier2'); t2.hidden = !ts;
  if (ts) { t2.replaceChildren(el('span', { textContent: ts.long, style: 'white-space:pre-line' }), el('i', {}, el('u', { style: `width:${ts.pct}%` }))); }
}
function removeLine(id) {
  const qty = cart[id], p = byId(id);
  setQty(id, 0);
  toast('تم حذف «' + (p ? p.disp : '') + '»', 'تراجع', () => setQty(id, qty));
}
function clearCart() {
  const backup = cart; setCart({});
  toast('تم تفريغ السلة', 'تراجع', () => setCart(backup));
}

// ===== الطبقات: نافذة الطلب والمعاينة (زر الرجوع في الهاتف يغلقها) =====
let layer = null, zoomId = null;
function openLayer(name) {
  if (layer) closeLayer(true);
  layer = name; const L = $('#' + name); L.classList.add('open'); L.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lock'); history.pushState({ layer: name }, '');
}
function closeLayer(silent) {
  if (!layer) return;
  const L = $('#' + layer); L.classList.remove('open'); L.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('lock'); zoomId = null; layer = null;
  if (!silent && history.state && history.state.layer) history.back();
}
window.addEventListener('popstate', () => { if (layer) closeLayer(true); });
function openSheet() { $('#sent').hidden = true; renderLines(); openLayer('sheet'); }
function openZoom(p) {
  zoomId = p.id; $('#zname').textContent = p.disp + (p.tag ? ' — ' + p.tag : '');
  const img = $('#zimg'); img.dataset.f = ''; img.onerror = () => { img.onerror = null; img.src = thumb(p); }; img.src = full(p); img.alt = p.name;
  $('#zprice').replaceChildren(...priceNode(p).childNodes); fillZoomAct(); openLayer('zoom');
}
function fillZoomAct() { const p = byId(zoomId); if (p) $('#zact').replaceChildren(actFor(p)); }

// ===== نموذج العميل (من config.json، ويحفظ بياناته) =====
const AUTO = { name: 'organization', phone: 'tel', address: 'street-address' };
function buildForm() {
  const saved = ls.get('cust_v1', {}), f = $('#form');
  for (const d of cfg.customerFields) {
    const props = { id: 'f_' + d.id, value: saved[d.id] || '', autocomplete: AUTO[d.id] || 'off',
      oninput: e => { saved[d.id] = e.target.value; ls.set('cust_v1', saved); e.target.closest('.fld').classList.remove('bad'); } };
    if (d.type !== 'textarea') { props.type = d.type || 'text'; if (d.type === 'tel') props.inputMode = 'tel'; }
    f.append(el('div', { className: 'fld' }, el('label', { htmlFor: 'f_' + d.id }, d.label, d.required ? el('i', { textContent: ' *' }) : null),
      el(d.type === 'textarea' ? 'textarea' : 'input', props)));
  }
}
function fieldError(id, msg) {
  const f = $('#f_' + id); f.closest('.fld').classList.add('bad'); f.focus({ preventScroll: false }); f.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast(msg);
}

// ===== إرسال الطلب =====
function sendOrder() {
  const { t, n } = totals();
  if (!n) return toast('السلة فارغة');
  const v = {};
  for (const d of cfg.customerFields) {
    v[d.id] = $('#f_' + d.id).value.trim();
    if (d.required && !v[d.id]) return fieldError(d.id, 'الرجاء إدخال: ' + d.label);
  }
  if (v.phone && cfg.phonePattern) {
    const num = digits(v.phone).replace(new RegExp('^(00)?' + (cfg.countryCode || '')), '').replace(/^0/, '');
    if (!new RegExp(cfg.phonePattern).test(num)) return fieldError('phone', 'رقم الهاتف غير صحيح');
  }
  const ids = Object.keys(cart).filter(k => byId(k) && avail(byId(k)));
  const items = ids.map((k, i) => {
    const p = byId(k), qn = cart[k];
    return `${i + 1}. *${p.name}*\n   ${qn} × ${fmt(priceOf(p))} = ${money(priceOf(p) * qn)}`;
  }).join('\n');
  const customer = cfg.customerFields.map(d => v[d.id] && `${d.label}: ${v[d.id]}`).filter(Boolean).join('\n');
  const m = { brand: cfg.brand.name, date: new Date().toLocaleString('ar-IQ'), orderId: Date.now().toString().slice(-6),
    warehouse: lists().length > 1 ? '🏬 المذخر: ' + curList().name + '\n' : '', items, total: money(t), customer };
  const msg = cfg.messageTemplate.replace(/\{(\w+)\}/g, (_, k) => m[k] ?? '');
  const url = `https://wa.me/${digits(curList().whatsapp || cfg.whatsapp)}?text=${encodeURIComponent(msg)}`;
  ls.set('last_v2', { list: cur, items: Object.fromEntries(ids.map(k => [k, cart[k]])), at: Date.now() });
  $('#sent').hidden = false; $('#sent').scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (!window.open(url, '_blank')) location.href = url;
}

// ===== إعادة آخر طلب =====
function renderReorder() {
  const b = $('#reorder'), last = ls.get('last_v2', null);
  const valid = last ? Object.keys(last.items).filter(id => byId(id)) : [];
  b.hidden = !(valid.length && !Object.keys(cart).length);
  if (b.hidden) return;
  b.textContent = `↻ إعادة آخر طلب (${valid.length} صنف)`;
  b.onclick = () => {
    if (last.list && lists().some(l => l.id === last.list) && last.list !== cur) { cur = last.list; ls.set('list_v2', cur); drawSeg(); drawGrid(); }
    setCart(Object.fromEntries(valid.map(id => [id, last.items[id]])));
    toast('تمت إعادة الطلب السابق — راجع الأسعار');
  };
}

// ===== تنبيه صغير =====
let tt;
function toast(msg, act, fn) {
  const t = $('#toast'); t.replaceChildren(el('span', { textContent: msg }));
  if (act) t.append(el('button', { type: 'button', textContent: act, onclick: () => { fn(); t.classList.remove('show'); } }));
  t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), act ? 5000 : 2400);
}

// ===== التثبيت (PWA) =====
let deferred = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; const b = $('#installBtn'); if (b) b.hidden = false; });
addEventListener('appinstalled', () => { deferred = null; $('#installBtn').hidden = true; toast('تم تثبيت التطبيق ✅'); });
function setupInstall() {
  $('#installBtn').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#installBtn').hidden = true; };
  if (deferred) $('#installBtn').hidden = false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (ios && !standalone && !ls.get('ios_hint', 0)) setTimeout(() => { $('#ios').hidden = false; }, 2500);
  $('#iosX').onclick = () => { $('#ios').hidden = true; ls.set('ios_hint', 1); };
  const off = () => { $('#offline').hidden = navigator.onLine; };
  addEventListener('online', off); addEventListener('offline', off); off();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ===== التشغيل =====
function skeleton() { $('#grid').replaceChildren(...Array.from({ length: 8 }, () => el('div', { className: 'sk' }))); }
async function init() {
  document.querySelectorAll('[data-i]').forEach(n => n.innerHTML = IC[n.dataset.i] || '');
  skeleton(); setupInstall();
  try { [cfg, products] = await Promise.all([load('config.json'), load('products.json')]); }
  catch (e) {
    $('#grid').replaceChildren();
    $('#status').replaceChildren('تعذر تحميل البيانات — تأكد من الاتصال بالإنترنت', el('button', { type: 'button', textContent: 'إعادة المحاولة', onclick: () => location.reload() }));
    return;
  }
  const seen = new Set();
  products.forEach((p, i) => {   // معرّف ثابت لكل منتج (لا يتغير بتغيّر السعر أو الترتيب)
    p.name = p.name.trim(); p.price = Number(p.price); prettify(p);
    let id = p.id || [p.name.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-'), p.type].join('_');
    if (seen.has(id)) id += '_' + i;
    seen.add(id); p.id = id;
  });
  for (const k in cart) if (!byId(k)) delete cart[k];
  document.title = cfg.brand.name;
  document.documentElement.style.setProperty('--brand', cfg.brand.color);
  $('#brand').textContent = cfg.brand.short || cfg.brand.name; $('#tagline').textContent = cfg.brand.tagline || '';
  if (cfg.brand.logo) $('#logo').src = cfg.brand.logo;

  const raw = await load('pricelists.json').catch(() => ({})); priceMap = {};
  for (const k in raw) {   // مطابقة مرنة + تحذيرات في Console (F12) تكشف الأخطاء
    priceMap[k] = {};
    for (const n in raw[k]) {
      priceMap[k][norm(n)] = raw[k][n];
      if (!products.some(p => norm(p.name) === norm(n.split('::')[0]))) console.warn('pricelists.json: اسم لا يطابق أي منتج ->', k, '|', n);
    }
    if (!lists().some(l => l.id === k)) console.warn('pricelists.json: القائمة غير معرّفة في config.json ->', k);
  }
  lists().forEach(l => { if (l.id !== 'base' && !raw[l.id]) console.warn('لا توجد أسعار في pricelists.json للقائمة ->', l.id); });
  const L = lists();
  cur = ls.get('list_v2', '');
  if (!L.some(l => l.id === cur)) cur = L.length ? L[0].id : '';
  if (L.length > 1) { $('#listbar').hidden = false; drawSeg(); }

  buildForm(); drawChips(); drawGrid(); renderCart(); renderReorder();

  $('#search').oninput = e => { q = e.target.value.trim(); drawGrid(); };
  $('#cartBtn').onclick = openSheet;
  $('#send').onclick = sendOrder;
  $('#clear').onclick = () => { closeLayer(); clearCart(); };
  $('#sentYes').onclick = () => { closeLayer(); setCart({}); toast('تم تفريغ السلة — شكراً لطلبك 🌿'); };
  $('#sentNo').onclick = () => { $('#sent').hidden = true; };
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeLayer());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLayer(); });

  load('offers.json').then(d => {   // العروض اختيارية
    offers = d; renderCart();
    const o = (d.offers || []).filter(x => x.content); if (!o.length) return;
    const b = $('#offer'); let i = 0;
    const show = () => {
      const x = o[i]; i = (i + 1) % o.length;
      b.querySelector('.o-t').textContent = x.title || 'عرض خاص';
      b.querySelector('.o-x').textContent = x.content.replace(/\s(\d{1,2})-(?=[^\d\s])/g, '\n$1- ').trim();
      b.hidden = false;
    };
    b.onclick = () => b.setAttribute('aria-expanded', String(b.getAttribute('aria-expanded') !== 'true'));
    show(); if (o.length > 1) setInterval(() => { if (b.getAttribute('aria-expanded') !== 'true') show(); }, 6000);
  }).catch(() => {});
}
init();
