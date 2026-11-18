'use strict';
/* =====================================================================
   لوحة المندوب — تحفظ التعديلات مباشرة في مستودع GitHub (commit واحد)
   - المفتاح (Token) يُخزَّن مشفّراً بكلمة المرور (AES-GCM + PBKDF2) على هذا الجهاز فقط
   - البيانات تُقرأ وتُكتب عبر GitHub API؛ والصيادلة يرونها بعد نشر GitHub Pages
   ===================================================================== */
const API = 'https://api.github.com';
const FILES = ['config.json', 'products.json', 'pricelists.json', 'offers.json'];
const DEFAULT_REPO = '86Mustafa/dajla-pharma-catalog';
const IDLE_MS = 10 * 60 * 1000;

// ---------- أدوات ----------
const $ = s => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const { attrs, ...rest } = props, e = document.createElement(tag);
  Object.assign(e, rest);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  e.append(...kids.flat().filter(k => k != null && k !== false));
  return e;
};
const fmt = n => Number(n).toLocaleString('en-US');
const clone = o => JSON.parse(JSON.stringify(o));
const norm = s => String(s).toLowerCase().replace(/[\s\-–—_/().]+/g, '');
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const IC = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
};
const icon = n => { const s = el('span'); s.innerHTML = IC[n]; s.style.display = 'grid'; return s; };
let tt;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2800); }
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ---------- التشفير ----------
async function keyFrom(pw, salt) {
  const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(pw, obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pw, salt), enc.encode(JSON.stringify(obj))));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function unseal(pw, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await keyFrom(pw, unb64(box.salt)), unb64(box.ct));
  return JSON.parse(dec.decode(pt));
}

// ---------- GitHub ----------
let token = null, RP = DEFAULT_REPO, BR = 'main';
async function gh(path, method = 'GET', body) {
  let r;
  try {
    r = await fetch(API + path, { method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { throw Object.assign(new Error('تعذر الاتصال بـ GitHub — تأكد من الإنترنت'), { net: true }); }
  if (!r.ok) {
    const m = { 401: 'المفتاح غير صالح أو منتهي الصلاحية', 403: 'المفتاح لا يملك صلاحية كافية (يجب Contents: Read and write)', 404: 'المستودع غير موجود أو المفتاح لا يصل إليه', 409: 'تعارض في النشر', 422: 'تعذر النشر (قد يكون الفرع تغيّر)' }[r.status] || ('خطأ من GitHub: ' + r.status);
    throw Object.assign(new Error(m), { status: r.status });
  }
  return r.status === 204 ? null : r.json();
}

// ---------- الحالة ----------
let base = null;                 // النسخة المنشورة { commit, shas, paths, data }
let D = null;                    // المسودة الحالية { cfg, products, pricelists, offers }
let nextU = 0;
const pending = new Map();       // اسم الصورة -> { full:Blob, thumb:Blob, url }
const delImgs = new Set();       // صور ستُحذف من المستودع
let tab = 'items', idleT = null;

const lists = () => (D.cfg.priceLists || []);
const catLabel = t => (D.cfg.categories || {})[t] || t;

// ---------- مفاتيح الأسعار في pricelists.json ----------
function shared(p) { return D.products.some(q => q !== p && norm(q.name) === norm(p.name)); }
function findKey(list, p) {
  const m = D.pricelists[list] || {}, spec = norm(p.name) + '::' + p.type; let plain = null;
  for (const k in m) { const nk = norm(k); if (nk === spec) return k; if (nk === norm(p.name)) plain = k; }
  return plain;
}
const isSpecific = (k, p) => norm(k) === norm(p.name) + '::' + p.type;
function getPrice(list, p) { const k = findKey(list, p); return k == null ? null : Number(D.pricelists[list][k]); }
function setPrice(list, p, v) {
  const m = D.pricelists[list] = D.pricelists[list] || {}, k = findKey(list, p);
  if (v === '' || v == null || isNaN(Number(v))) { if (k && (isSpecific(k, p) || !shared(p))) delete m[k]; return; }
  v = Number(v);
  if (k && (isSpecific(k, p) || !shared(p))) m[k] = v; else m[p.name + '::' + p.type] = v;
}

// ---------- تحميل المستودع ----------
async function loadRepo() {
  const ref = await gh(`/repos/${RP}/git/ref/heads/${BR}`), commit = ref.object.sha;
  const c = await gh(`/repos/${RP}/git/commits/${commit}`);
  const tr = await gh(`/repos/${RP}/git/trees/${c.tree.sha}?recursive=1`);
  const shas = {}, raw = {};
  await Promise.all(FILES.map(async f => {
    const e = tr.tree.find(x => x.path === f); if (!e) throw new Error('ملف غير موجود في المستودع: ' + f);
    shas[f] = e.sha;
    const b = await gh(`/repos/${RP}/git/blobs/${e.sha}`);
    raw[f] = JSON.parse(dec.decode(unb64(b.content.replace(/\s/g, ''))));
  }));
  const data = { cfg: raw['config.json'], products: raw['products.json'], pricelists: raw['pricelists.json'], offers: raw['offers.json'] };
  data.offers.offers = data.offers.offers || []; data.offers.tiers = data.offers.tiers || [];
  base = { commit, shas, paths: new Set(tr.tree.map(x => x.path)), data };
  D = clone(data); D.products.forEach((p, i) => p._u = i); nextU = D.products.length;
  pending.clear(); delImgs.clear();
  const dr = ls.get('adm_draft', null);
  if (dr && dr.commit === commit) { D = dr.D; nextU = dr.nextU; (dr.del || []).forEach(x => delImgs.add(x)); D._restored = true; }
}
function persist() { ls.set('adm_draft', { commit: base.commit, D, nextU, del: [...delImgs] }); }
function touch() { persist(); drawPub(); }

// ---------- حساب التغييرات ----------
const cleanProducts = () => D.products.map(p => ({ name: p.name.trim(), type: p.type, price: Number(p.price), image: p.image || '', disabled: !!p.disabled }));
function outFiles() {
  return { 'config.json': D.cfg, 'products.json': cleanProducts(), 'pricelists.json': D.pricelists, 'offers.json': D.offers };
}
const baseFiles = () => ({ 'config.json': base.data.cfg, 'products.json': base.data.products, 'pricelists.json': base.data.pricelists, 'offers.json': base.data.offers });
function changedFiles() {
  const o = outFiles(), b = baseFiles();
  return FILES.filter(f => JSON.stringify(o[f]) !== JSON.stringify(b[f]));
}
const fmtPhone = n => { n = String(n || ''); return n.startsWith('964') ? '0' + n.slice(3).replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : n; };
function changes() {
  const out = [], bd = base.data;
  if (D.cfg.whatsapp !== bd.cfg.whatsapp) out.push(`📱 رقم واتساب الطلبات: من \u2066${fmtPhone(bd.cfg.whatsapp)}\u2069 إلى \u2066${fmtPhone(D.cfg.whatsapp)}\u2069`);
  const rest = c => { const x = clone(c); delete x.whatsapp; (x.priceLists || []).forEach(l => delete l.whatsapp); return JSON.stringify(x); };
  if (rest(D.cfg) !== rest(bd.cfg)) out.push('⚙️ تعديل إعدادات الواجهة (الاسم/الشعار/الأنواع)');
  const added = [], edited = [], priced = [], gone = [];
  const seen = new Set();
  for (const p of D.products) {
    const b = p._u < bd.products.length ? bd.products[p._u] : null;
    if (!b || p._u >= 1e6) { added.push(p.name.trim()); continue; }
    seen.add(p._u);
    if (p.name.trim() !== b.name.trim() || p.type !== b.type || (p.image || '') !== (b.image || '') || !!p.disabled !== !!b.disabled) edited.push(p.name.trim());
    if (Number(p.price) !== Number(b.price)) priced.push(p.name.trim());
  }
  bd.products.forEach((b, i) => { if (!seen.has(i)) gone.push(b.name.trim()); });
  if (added.length) out.push(`➕ أصناف جديدة (${added.length}): ${added.slice(0, 4).join('، ')}${added.length > 4 ? '…' : ''}`);
  if (gone.length) out.push(`🗑 أصناف محذوفة (${gone.length}): ${gone.slice(0, 4).join('، ')}${gone.length > 4 ? '…' : ''}`);
  if (edited.length) out.push(`✏️ أصناف معدّلة (${edited.length}): ${edited.slice(0, 4).join('، ')}${edited.length > 4 ? '…' : ''}`);
  if (priced.length) out.push(`💰 السعر الأساسي تغيّر لـ ${priced.length} صنف`);
  for (const l of lists()) {
    const a = D.pricelists[l.id] || {}, b = bd.pricelists[l.id] || {}; let n = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) n++;
    if (n) out.push(`🏬 أسعار مذخر «${l.name}»: ${n} تغيير`);
  }
  if (JSON.stringify(D.offers) !== JSON.stringify(bd.offers)) out.push('🎁 تعديل العروض/مستويات البونص');
  return out;
}
function validate() {
  const errs = [], seen = new Set();
  if (!/^9647\d{9}$/.test(D.cfg.whatsapp || '')) errs.push('رقم الواتساب غير صحيح');
  for (const p of D.products) {
    const nm = p.name.trim();
    if (!nm) errs.push('يوجد صنف بلا اسم');
    if (!(Number(p.price) >= 0) || p.price === '') errs.push(`سعر غير صحيح للصنف: ${nm}`);
    const k = norm(nm) + '::' + p.type; if (seen.has(k)) errs.push(`اسم مكرر: ${nm}`); seen.add(k);
  }
  return errs;
}

// ---------- الواجهة العامة ----------
const app = () => $('#app');
function spinner(msg) { app().replaceChildren(el('div', { className: 'spin' }, el('i'), el('p', { textContent: msg || 'جارٍ التحميل…' }))); }
function gateLogo() { return el('div', { className: 'logo' }, el('img', { src: 'icons/logo.png', alt: '' })); }

function renderSetup() {
  document.body.classList.remove('lock');
  const f = {};
  const field = (id, label, props = {}, hint) => el('div', { className: 'fld' }, el('label', { htmlFor: id, textContent: label }), (f[id] = el('input', { id, ...props })), hint && el('small', { textContent: hint }));
  const err = el('p', { className: 'err', hidden: true });
  const go = el('button', { type: 'button', className: 'btn block', textContent: 'حفظ والدخول' });
  go.onclick = async () => {
    err.hidden = true;
    const repo = f.repo.value.trim(), tk = f.tok.value.trim(), pw = f.pw.value;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return showErr('اسم المستودع يجب أن يكون بالشكل owner/repo');
    if (tk.length < 20) return showErr('ألصق مفتاح GitHub كاملاً');
    if (pw.length < 6) return showErr('كلمة المرور 6 أحرف على الأقل');
    if (pw !== f.pw2.value) return showErr('كلمتا المرور غير متطابقتين');
    go.disabled = true; go.textContent = 'جارٍ التحقق…';
    token = tk; RP = repo;
    try {
      const r = await gh(`/repos/${RP}`);
      if (!r.permissions || !r.permissions.push) throw new Error('المفتاح لا يملك صلاحية الكتابة (Contents: Read and write)');
      BR = r.default_branch || 'main';
      ls.set('adm_box', { box: await seal(pw, { token: tk }), repo: RP, branch: BR }); ls.del('adm_fail');
      await enter();
    } catch (e) { token = null; go.disabled = false; go.textContent = 'حفظ والدخول'; showErr(e.message); }
  };
  function showErr(m) { err.textContent = m; err.hidden = false; }
  app().replaceChildren(el('div', { className: 'gate' }, gateLogo(),
    el('h1', { textContent: 'إعداد لوحة المندوب' }), el('p', { className: 'sub', textContent: 'خطوة تُجرى مرة واحدة على هذا الجهاز' }),
    el('div', { className: 'box' },
      el('h3', { className: 'h2', textContent: 'أولاً: أنشئ مفتاح GitHub (دقيقتان)' }),
      el('ol', { className: 'steps' },
        el('li', {}, 'افتح GitHub وسجّل الدخول، ثم: ', el('b', { textContent: 'Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens' })),
        el('li', {}, 'اضغط ', el('b', { textContent: 'Generate new token' }), ' وسمّه مثلاً ', el('code', { textContent: 'dajla-admin' })),
        el('li', {}, 'Expiration: اختر سنة. ', el('b', { textContent: 'Repository access ← Only select repositories' }), ' واختر مستودع الكتالوج فقط'),
        el('li', {}, el('b', { textContent: 'Permissions ← Repository permissions ← Contents ← Read and write' })),
        el('li', {}, 'اضغط Generate وانسخ المفتاح (يبدأ بـ ', el('code', { textContent: 'github_pat_' }), ') والصقه أدناه'))),
    el('div', { className: 'box' },
      field('repo', 'المستودع', { value: DEFAULT_REPO, className: 'ltr', autocomplete: 'off' }),
      field('tok', 'مفتاح GitHub', { type: 'password', className: 'ltr', autocomplete: 'off', placeholder: 'github_pat_…' }, 'يُحفظ مشفّراً على هذا الجهاز ولا يظهر لأحد.'),
      field('pw', 'كلمة مرور اللوحة', { type: 'password', autocomplete: 'new-password' }, 'اخترها أنت وتذكّرها؛ بدونها لا يمكن فتح اللوحة.'),
      field('pw2', 'تأكيد كلمة المرور', { type: 'password', autocomplete: 'new-password' }),
      err, go)));
}

function renderLogin(msg) {
  const st = ls.get('adm_fail', { n: 0, until: 0 });
  const pw = el('input', { id: 'lpw', type: 'password', autocomplete: 'current-password', placeholder: 'كلمة المرور', autofocus: true });
  const err = el('p', { className: 'err', hidden: !msg, textContent: msg || '' });
  const go = el('button', { type: 'button', className: 'btn block', textContent: 'دخول' });
  const submit = async () => {
    const left = Math.ceil((st.until - Date.now()) / 1000);
    if (left > 0) { err.hidden = false; err.textContent = `محاولات كثيرة — انتظر ${left} ثانية`; return; }
    go.disabled = true; go.textContent = 'جارٍ الفتح…';
    const s = ls.get('adm_box');
    try {
      token = (await unseal(pw.value, s.box)).token; RP = s.repo; BR = s.branch || 'main'; ls.del('adm_fail');
      await enter();
    } catch (e) {
      token = null; go.disabled = false; go.textContent = 'دخول';
      if (e.net || e.status) { err.hidden = false; err.textContent = e.message; return; }
      st.n++; st.until = st.n >= 3 ? Date.now() + Math.min(300, 5 * 2 ** (st.n - 3)) * 1000 : 0; ls.set('adm_fail', st);
      err.hidden = false; err.textContent = 'كلمة المرور غير صحيحة'; pw.value = ''; pw.focus();
    }
  };
  go.onclick = submit; pw.onkeydown = e => { if (e.key === 'Enter') submit(); };
  const reset = el('button', { type: 'button', className: 'link', textContent: 'نسيت كلمة المرور؟ إعادة الإعداد',
    onclick: () => { if (confirm('سيُحذف المفتاح المحفوظ على هذا الجهاز وتُنشئ كلمة مرور جديدة (لا يتأثر الكتالوج). متابعة؟')) { ls.del('adm_box'); ls.del('adm_draft'); renderSetup(); } } });
  app().replaceChildren(el('div', { className: 'gate' }, gateLogo(), el('h1', { textContent: 'لوحة المندوب' }), el('p', { className: 'sub', textContent: 'أدخل كلمة المرور للمتابعة' }),
    el('div', { className: 'box' }, el('div', { className: 'fld' }, pw), err, go), el('div', { style: 'text-align:center' }, reset)));
  setTimeout(() => pw.focus(), 50);
}

async function enter() {
  spinner('جارٍ تحميل بيانات الكتالوج من GitHub…');
  try { await loadRepo(); }
  catch (e) { token = null; renderLogin(e.message); return; }
  tab = 'items'; renderApp(); armIdle();
  if (D._restored) { delete D._restored; toast('تم استرجاع مسودتك غير المنشورة'); }
}
function lock(msg) {
  token = null; clearTimeout(idleT); persist && base && persist();
  document.body.classList.remove('lock'); renderLogin(msg);
}
function armIdle() {
  const reset = () => { clearTimeout(idleT); if (token) idleT = setTimeout(() => lock('تم قفل اللوحة بعد فترة خمول'), IDLE_MS); };
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, reset, { passive: true })); reset();
}

// ---------- هيكل اللوحة ----------
const TABS = [['items', 'الأصناف'], ['prices', 'الأسعار'], ['offers', 'العروض'], ['settings', 'الإعدادات']];
function renderApp() {
  app().replaceChildren(
    el('header', { className: 'top' }, el('div', { className: 'top-in' }, el('h1', { textContent: 'لوحة المندوب' }),
      el('a', { href: './', target: '_blank', rel: 'noopener' }, icon('eye'), 'التطبيق'),
      el('button', { type: 'button', onclick: () => lock() }, icon('lock'), 'قفل'))),
    el('nav', { className: 'tabs', id: 'tabs' }), el('main', { id: 'main' }), el('div', { id: 'pub', className: 'pub', hidden: true }));
  drawTabs(); drawTab(); drawPub();
}
function drawTabs() {
  $('#tabs').replaceChildren(...TABS.map(([k, t]) => el('button', { type: 'button', className: k === tab ? 'on' : '', textContent: t, onclick: () => { tab = k; drawTabs(); drawTab(); window.scrollTo(0, 0); } })));
}
function drawTab() {
  const m = $('#main'); m.replaceChildren();
  ({ items: tabItems, prices: tabPrices, offers: tabOffers, settings: tabSettings })[tab](m);
}
function drawPub() {   // يُحدَّث النص فقط (لا نعيد بناء الزر حتى لا تضيع نقرة المستخدم أثناء إغلاق حقل الإدخال)
  const p = $('#pub'); if (!p) return;
  const n = changes().length; p.hidden = !n;
  if (!p.firstChild) p.append(el('div', { className: 'pub-in' }, el('span', { id: 'pubN' }), el('button', { type: 'button', textContent: 'مراجعة ونشر', onclick: openPublish })));
  $('#pubN').textContent = `${n} تغيير غير منشور`;
}

// ---------- النوافذ ----------
function modal(title, body, footer, onClose) {
  const close = () => { L.remove(); if (!document.querySelector('.layer')) document.body.classList.remove('lock'); onClose && onClose(); };
  const L = el('div', { className: 'layer' }, el('div', { className: 'back', onclick: close }),
    el('section', { className: 'modal', attrs: { role: 'dialog', 'aria-modal': 'true' } },
      el('header', {}, el('h2', { textContent: title }), el('button', { type: 'button', className: 'ib', attrs: { 'aria-label': 'إغلاق' }, onclick: close }, icon('close'))),
      el('div', { className: 'body' }, body), footer && el('footer', {}, ...footer(close))));
  document.body.append(L); document.body.classList.add('lock');
  return close;
}
function confirmBox(msg, ok = 'تأكيد', danger = true, extra) {
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    modal('تأكيد', [el('p', { textContent: msg, style: 'font-weight:700;margin-bottom:10px' }), extra], close => [
      el('button', { type: 'button', className: 'btn ghost', textContent: 'إلغاء', onclick: () => { fin(false); close(); } }),
      el('button', { type: 'button', className: 'btn' + (danger ? ' danger' : ''), textContent: ok, onclick: () => { fin(true); close(); } })], () => fin(false));
  });
}

// ---------- تبويب الأصناف ----------
let iq = '', icat = 'all';
const thumbSrc = p => pending.has(p.image) ? pending.get(p.image).url : p.image ? 'thumbs/' + encodeURI(p.image) : 'icons/logo.png';
function tabItems(m) {
  const q = el('input', { type: 'search', placeholder: 'ابحث عن صنف…', value: iq, oninput: e => { iq = e.target.value.trim(); drawItems(); } });
  m.append(el('div', { className: 'search' }, q, el('button', { type: 'button', className: 'btn', onclick: () => openEditor(null) }, icon('plus'), 'صنف جديد')),
    el('div', { className: 'chips', id: 'ichips' }), el('div', { className: 'list', id: 'ilist' }));
  drawChips('#ichips', () => icat, v => { icat = v; drawItems(); });
  drawItems();
}
function drawChips(sel, get, set) {
  const types = [...new Set(D.products.map(p => p.type))], c = $(sel); c.replaceChildren();
  for (const t of ['all', ...types]) c.append(el('button', { type: 'button', className: 'chip' + (get() === t ? ' on' : ''), textContent: t === 'all' ? 'الكل' : catLabel(t),
    onclick: () => { set(t); drawChips(sel, get, set); } }));
}
function drawItems() {
  const L = $('#ilist'); L.replaceChildren();
  const ws = iq.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = D.products.filter(p => (icat === 'all' || p.type === icat) && ws.every(w => (p.name + ' ' + catLabel(p.type)).toLowerCase().includes(w)));
  if (!rows.length) return L.append(el('div', { className: 'empty', textContent: 'لا توجد أصناف' }));
  for (const p of rows) {
    const sw = el('button', { type: 'button', className: 'sw', attrs: { role: 'switch', 'aria-checked': String(!p.disabled), 'aria-label': 'متوفر' },
      onclick: () => { p.disabled = !p.disabled; sw.setAttribute('aria-checked', String(!p.disabled)); row.classList.toggle('off', !!p.disabled); touch(); } });
    const row = el('div', { className: 'item' + (p.disabled ? ' off' : '') },
      el('img', { src: thumbSrc(p), alt: '', loading: 'lazy', onerror() { this.onerror = null; this.src = 'icons/logo.png'; } }),
      el('div', {}, el('div', { className: 'n', textContent: p.name.trim() }), el('div', { className: 'm' }, catLabel(p.type) + ' · ', el('b', { textContent: fmt(p.price || 0) }))),
      el('div', { className: 'acts' }, sw,
        el('button', { type: 'button', className: 'ib', attrs: { 'aria-label': 'تعديل' }, onclick: () => openEditor(p) }, icon('edit')),
        el('button', { type: 'button', className: 'ib del', attrs: { 'aria-label': 'حذف' }, onclick: () => removeItem(p) }, icon('trash'))));
    L.append(row);
  }
}
async function removeItem(p) {
  const imgFree = p.image && !D.products.some(q => q !== p && q.image === p.image) && (base.paths.has('images/' + p.image) || base.paths.has('thumbs/' + p.image));
  const cb = el('input', { type: 'checkbox', checked: true });
  const chk = imgFree ? el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:14px' }, cb, 'حذف صورته من المستودع أيضاً') : null;
  if (!await confirmBox(`حذف الصنف «${p.name.trim()}» نهائياً مع أسعاره في كل المذاخر؟`, 'حذف', true, chk)) return;
  const alsoImg = !!chk && cb.checked;
  for (const l of lists()) setPrice(l.id, p, '');
  D.products = D.products.filter(q => q !== p);
  if (alsoImg) ['images/', 'thumbs/'].forEach(d => base.paths.has(d + p.image) && delImgs.add(d + p.image));
  touch(); drawItems(); drawChips('#ichips', () => icat, v => { icat = v; drawItems(); }); toast('تم الحذف (لن يظهر للصيادلة قبل النشر)');
}
async function readImage(file) {
  let bmp; try { bmp = await createImageBitmap(file); } catch { throw new Error('صيغة الصورة غير مدعومة — استخدم JPG أو PNG'); }
  const mk = (max, q) => { const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', q)); };
  const [full, thumb] = await Promise.all([mk(1000, .8), mk(360, .76)]);
  return { full, thumb, url: URL.createObjectURL(thumb) };
}
function openEditor(p) {
  const isNew = !p, o = isNew ? { name: '', type: Object.keys(D.cfg.categories || { tab: 'أقراص' })[0], price: '', image: '', disabled: false } : p;
  let newImg = null;
  const f = {};
  const mk = (id, label, node, hint) => el('div', { className: 'fld' }, el('label', { htmlFor: id, textContent: label }), node, hint && el('small', { textContent: hint }));
  f.name = el('input', { id: 'e_name', value: o.name.trim() });
  f.type = el('select', { id: 'e_type' }, ...Object.entries(D.cfg.categories || {}).map(([k, v]) => el('option', { value: k, textContent: v, selected: k === o.type })));
  f.price = el('input', { id: 'e_price', type: 'number', inputMode: 'numeric', min: 0, value: o.price === '' ? '' : o.price });
  const lp = {}; for (const l of lists()) lp[l.id] = el('input', { type: 'number', inputMode: 'numeric', min: 0, id: 'e_l_' + l.id, placeholder: 'يتبع السعر الأساسي', value: isNew ? '' : (getPrice(l.id, o) ?? '') });
  const prev = el('img', { src: thumbSrc(o), alt: '', onerror() { this.onerror = null; this.src = 'icons/logo.png'; } });
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
    const fl = e.target.files[0]; if (!fl) return;
    try { newImg = await readImage(fl); prev.src = newImg.url; } catch (er) { toast(er.message); } } });
  f.dis = el('input', { type: 'checkbox', checked: !!o.disabled, id: 'e_dis' });
  const body = [
    el('div', { className: 'pic' }, prev, el('div', {}, el('button', { type: 'button', className: 'btn ghost sm', textContent: 'اختيار صورة', onclick: () => file.click() }), file,
      el('small', { style: 'display:block;color:var(--muted);margin-top:4px', textContent: 'تُضغط تلقائياً لتناسب الهاتف' }))),
    mk('e_name', 'اسم الصنف', f.name), mk('e_type', 'النوع', f.type), mk('e_price', 'السعر الأساسي', f.price, 'يُستخدم عند عدم وجود سعر خاص بالمذخر'),
    lists().length ? el('h3', { className: 'h2', textContent: 'أسعار المذاخر' }) : null,
    ...lists().map(l => mk('e_l_' + l.id, 'سعر ' + l.name, lp[l.id])),
    el('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:700' }, f.dis, 'غير متوفر (إيقاف الصنف)')];
  modal(isNew ? 'صنف جديد' : 'تعديل الصنف', body, close => [
    el('button', { type: 'button', className: 'btn ghost', textContent: 'إلغاء', onclick: close }),
    el('button', { type: 'button', className: 'btn', textContent: 'حفظ في المسودة', onclick: () => {
      const name = f.name.value.trim(), type = f.type.value, price = f.price.value;
      if (!name) return toast('اكتب اسم الصنف');
      if (price === '' || !(Number(price) >= 0)) return toast('اكتب السعر الأساسي بشكل صحيح');
      if (D.products.some(q => q !== p && norm(q.name) === norm(name) && q.type === type)) return toast('يوجد صنف بنفس الاسم والنوع');
      let target = p, renamed = false;
      if (isNew) { target = { name, type, price: Number(price), image: '', disabled: f.dis.checked, _u: 1e6 + nextU++ }; }
      else {
        renamed = norm(name) !== norm(p.name) || type !== p.type;
        if (renamed) {   // نقل أسعار المذاخر إلى المفتاح الجديد
          for (const l of lists()) { const k = findKey(l.id, p); if (k && (isSpecific(k, p) || !shared(p))) delete D.pricelists[l.id][k]; }
        }
        Object.assign(p, { name, type, price: Number(price), disabled: f.dis.checked });
      }
      if (newImg) {
        const old = target.image, nm = 'item-' + Date.now().toString(36) + '.jpg';
        pending.set(nm, newImg); target.image = nm;
        if (old && base.paths.has('images/' + old) && !D.products.some(q => q !== target && q.image === old)) ['images/', 'thumbs/'].forEach(d => base.paths.has(d + old) && delImgs.add(d + old));
      }
      if (isNew) D.products.push(target);
      for (const l of lists()) { const v = lp[l.id].value; if (isNew || renamed || String(getPrice(l.id, target) ?? '') !== String(v)) setPrice(l.id, target, v); }
      touch(); close(); drawItems(); drawChips('#ichips', () => icat, v => { icat = v; drawItems(); }); toast('تم الحفظ في المسودة — انشر لتصل للصيادلة');
    } })]);
}

// ---------- تبويب الأسعار ----------
let pq = '', pcat = 'all';
function tabPrices(m) {
  const q = el('input', { type: 'search', placeholder: 'ابحث…', value: pq, oninput: e => { pq = e.target.value.trim(); drawPrices(); } });
  const col = el('select', { id: 'b_col' }, el('option', { value: 'base', textContent: 'السعر الأساسي' }), ...lists().map(l => el('option', { value: l.id, textContent: l.name })), el('option', { value: 'all', textContent: 'كل الأعمدة' }));
  const pct = el('input', { type: 'number', id: 'b_pct', placeholder: '+5 أو -3', step: 'any', inputMode: 'decimal' });
  const rnd = el('select', { id: 'b_rnd' }, el('option', { value: '1', textContent: 'تقريب لأقرب 1' }), el('option', { value: '5', textContent: 'لأقرب 5' }), el('option', { value: '25', textContent: 'لأقرب 25' }));
  const apply = el('button', { type: 'button', className: 'btn sm', textContent: 'تطبيق على المعروض', onclick: async () => {
    const pc = Number(pct.value); if (!pc) return toast('اكتب نسبة الزيادة أو الخفض');
    const rows = visiblePrices(); if (!rows.length) return;
    if (!await confirmBox(`تغيير ${col.selectedOptions[0].textContent} بنسبة ${pc > 0 ? '+' : ''}${pc}% لـ ${rows.length} صنف معروض؟`, 'تطبيق', false)) return;
    const r = Number(rnd.value), f = v => Math.max(0, Math.round(v * (1 + pc / 100) / r) * r);
    for (const p of rows) {
      if (col.value === 'base' || col.value === 'all') p.price = f(Number(p.price));
      for (const l of lists()) if (col.value === l.id || col.value === 'all') { const v = getPrice(l.id, p); if (v != null) setPrice(l.id, p, f(v)); }
    }
    pct.value = ''; touch(); drawPrices(); toast('تم التطبيق على المسودة');
  } });
  m.append(el('div', { className: 'search' }, q), el('div', { className: 'chips', id: 'pchips' }),
    el('details', { className: 'box' }, el('summary', { textContent: 'تعديل جماعي بنسبة مئوية', style: 'font-weight:800;cursor:pointer' }),
      el('div', { className: 'bulk', style: 'margin-top:10px' },
        el('div', { className: 'fld', style: 'margin:0' }, el('label', { textContent: 'العمود' }), col), el('div', { className: 'fld', style: 'margin:0' }, el('label', { textContent: 'النسبة %' }), pct),
        el('div', { className: 'fld', style: 'margin:0' }, el('label', { textContent: 'التقريب' }), rnd), apply),
      el('small', { style: 'color:var(--muted);display:block;margin-top:8px', textContent: 'يُطبّق على الأصناف الظاهرة حالياً (حسب البحث والقسم).' })),
    el('div', { className: 'tbl', id: 'ptbl' }));
  drawChips('#pchips', () => pcat, v => { pcat = v; drawPrices(); }); drawPrices();
}
function visiblePrices() {
  const ws = pq.toLowerCase().split(/\s+/).filter(Boolean);
  return D.products.filter(p => (pcat === 'all' || p.type === pcat) && ws.every(w => (p.name + ' ' + catLabel(p.type)).toLowerCase().includes(w)));
}
function drawPrices() {
  const T = $('#ptbl'); T.replaceChildren();
  const cols = `minmax(92px,1fr) repeat(${1 + lists().length},70px)`;
  T.append(el('div', { className: 'tr h', style: `grid-template-columns:${cols}` }, el('span', { textContent: 'الصنف' }), el('span', { textContent: 'الأساسي', style: 'text-align:center' }), ...lists().map(l => el('span', { textContent: l.name, style: 'text-align:center' }))));
  const rows = visiblePrices();
  if (!rows.length) T.append(el('div', { className: 'empty', textContent: 'لا توجد أصناف' }));
  for (const p of rows) {
    const bp = p._u < base.data.products.length ? base.data.products[p._u] : null;
    const bi = el('input', { type: 'number', inputMode: 'numeric', min: 0, value: p.price, className: bp && Number(bp.price) !== Number(p.price) ? 'ch' : '',
      onchange: e => { const v = e.target.value; if (v === '' || Number(v) < 0) { e.target.value = p.price; return; } p.price = Number(v); e.target.classList.toggle('ch', !bp || Number(bp.price) !== p.price); touch(); } });
    const cells = lists().map(l => {
      const cur = getPrice(l.id, p), orig = bp ? (() => { const hold = D.pricelists; D.pricelists = base.data.pricelists; const r = getPrice(l.id, bp); D.pricelists = hold; return r; })() : null;
      const i = el('input', { type: 'number', inputMode: 'numeric', min: 0, value: cur ?? '', placeholder: fmt(p.price), className: (cur ?? null) !== orig ? 'ch' : '',
        onchange: e => { setPrice(l.id, p, e.target.value); const n = getPrice(l.id, p); e.target.classList.toggle('ch', (n ?? null) !== orig); touch(); } });
      return i;
    });
    T.append(el('div', { className: 'tr', style: `grid-template-columns:${cols}` }, el('div', { className: 'nm' }, p.name.trim(), el('small', { textContent: catLabel(p.type) })), bi, ...cells));
  }
}

// ---------- تبويب العروض ----------
function tabOffers(m) {
  m.append(el('h3', { className: 'h2', textContent: 'نصوص العروض (تظهر في أعلى التطبيق)' }), el('div', { id: 'ofl' }),
    el('button', { type: 'button', className: 'btn ghost sm', onclick: () => { D.offers.offers.push({ title: 'عرض', content: '' }); touch(); drawOffers(); } }, icon('plus'), 'إضافة عرض'),
    el('h3', { className: 'h2', textContent: 'مستويات البونص (شريط التقدّم أسفل التطبيق)' }), el('div', { id: 'tiers' }),
    el('button', { type: 'button', className: 'btn ghost sm', onclick: () => { D.offers.tiers.push({ at: 1000000, label: '' }); touch(); drawOffers(); } }, icon('plus'), 'إضافة مستوى'));
  drawOffers();
}
function drawOffers() {
  const O = $('#ofl'), T = $('#tiers'); O.replaceChildren(); T.replaceChildren();
  D.offers.offers.forEach((o, i) => O.append(el('div', { className: 'box' },
    el('div', { className: 'fld' }, el('label', { textContent: 'العنوان' }), el('input', { value: o.title || '', oninput: e => { o.title = e.target.value; touch(); } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'نص العرض' }), el('textarea', { value: o.content || '', oninput: e => { o.content = e.target.value; touch(); } })),
    el('button', { type: 'button', className: 'btn danger sm', onclick: async () => { if (await confirmBox('حذف هذا العرض؟', 'حذف')) { D.offers.offers.splice(i, 1); touch(); drawOffers(); } } }, icon('trash'), 'حذف'))));
  if (!D.offers.offers.length) O.append(el('div', { className: 'empty', textContent: 'لا توجد عروض' }));
  D.offers.tiers.forEach((t, i) => T.append(el('div', { className: 'box' }, el('div', { className: 'rowline' },
    el('div', { className: 'fld', style: 'max-width:150px' }, el('label', { textContent: 'عند مبلغ (د.ع)' }), el('input', { type: 'number', inputMode: 'numeric', value: t.at, oninput: e => { t.at = Number(e.target.value) || 0; touch(); } })),
    el('div', { className: 'fld' }, el('label', { textContent: 'نص البونص' }), el('input', { value: t.label || '', oninput: e => { t.label = e.target.value; touch(); } })),
    el('button', { type: 'button', className: 'ib del', style: 'margin-top:24px', attrs: { 'aria-label': 'حذف' }, onclick: () => { D.offers.tiers.splice(i, 1); touch(); drawOffers(); } }, icon('trash'))))));
}

// ---------- تبويب الإعدادات ----------
function parsePhone(s) {
  let d = String(s).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('964')) return d; if (d.startsWith('0')) return '964' + d.slice(1); if (d.length === 10 && d[0] === '7') return '964' + d;
  return d;
}
function tabSettings(m) {
  const ph = el('input', { id: 's_ph', className: 'ltr', inputMode: 'tel', value: fmtPhone(D.cfg.whatsapp), placeholder: '07701234567' });
  const phF = el('div', { className: 'fld' }, el('label', { htmlFor: 's_ph', textContent: 'رقم واتساب الذي تصله الطلبات' }), ph, el('small', { textContent: 'اكتبه بالشكل 07xxxxxxxxx — يُحوَّل تلقائياً للصيغة الدولية.' }));
  ph.onchange = () => {
    const v = parsePhone(ph.value);
    if (!/^9647\d{9}$/.test(v)) { phF.classList.add('bad'); return toast('رقم غير صحيح: يجب أن يكون 11 رقماً يبدأ بـ 07'); }
    phF.classList.remove('bad'); D.cfg.whatsapp = v; (D.cfg.priceLists || []).forEach(l => delete l.whatsapp); ph.value = fmtPhone(v); touch();
  };
  const brand = (id, label, key) => el('div', { className: 'fld' }, el('label', { htmlFor: id, textContent: label }), el('input', { id, value: D.cfg.brand[key] || '', oninput: e => { D.cfg.brand[key] = e.target.value; touch(); } }));
  const cats = el('div', {});
  const drawCats = () => { cats.replaceChildren(...Object.entries(D.cfg.categories || {}).map(([k, v]) => el('div', { className: 'rowline' },
    el('div', { className: 'fld' }, el('input', { value: v, 'aria-label': 'اسم النوع', oninput: e => { D.cfg.categories[k] = e.target.value; touch(); } }))))); };
  drawCats();
  const newCat = el('input', { placeholder: 'اسم نوع جديد (مثل: حقن)' });
  m.append(el('div', { className: 'box' }, phF),
    el('h3', { className: 'h2', textContent: 'هوية التطبيق' }),
    el('div', { className: 'box' }, brand('s_b1', 'الاسم المختصر (يظهر في الترويسة)', 'short'), brand('s_b2', 'الاسم الكامل (يظهر في رسالة الطلب)', 'name'), brand('s_b3', 'العبارة الترحيبية', 'tagline')),
    el('h3', { className: 'h2', textContent: 'أنواع الأصناف' }), el('div', { className: 'box' }, cats,
      el('div', { className: 'rowline' }, el('div', { className: 'fld' }, newCat), el('button', { type: 'button', className: 'btn sm', textContent: 'إضافة', onclick: () => {
        const v = newCat.value.trim(); if (!v) return; D.cfg.categories = D.cfg.categories || {}; D.cfg.categories['c' + Date.now().toString(36)] = v; newCat.value = ''; touch(); drawCats(); } }))),
    el('h3', { className: 'h2', textContent: 'الأمان والنسخ الاحتياطي' }),
    el('div', { className: 'box row', style: 'flex-wrap:wrap' },
      el('button', { type: 'button', className: 'btn ghost sm', textContent: 'تغيير كلمة المرور', onclick: changePw }),
      el('button', { type: 'button', className: 'btn ghost sm', textContent: 'تنزيل نسخة احتياطية', onclick: backup }),
      el('button', { type: 'button', className: 'btn ghost sm', textContent: 'السجل والاسترجاع', onclick: openHistory })),
    el('div', { className: 'box', style: 'font-size:13px;color:var(--muted)' }, `المستودع: ${RP} (الفرع ${BR}) — آخر نسخة منشورة: ${base.commit.slice(0, 7)}`));
}
function backup() {
  const blob = new Blob([JSON.stringify({ date: new Date().toISOString(), ...baseFiles() }, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `dajla-backup-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(a); a.click(); a.remove();
}
function changePw() {
  const f = {}; const mk = (id, l) => el('div', { className: 'fld' }, el('label', { textContent: l, htmlFor: id }), (f[id] = el('input', { id, type: 'password', autocomplete: 'off' })));
  modal('تغيير كلمة المرور', [mk('p0', 'كلمة المرور الحالية'), mk('p1', 'كلمة المرور الجديدة'), mk('p2', 'تأكيد الجديدة')], close => [
    el('button', { type: 'button', className: 'btn ghost', textContent: 'إلغاء', onclick: close }),
    el('button', { type: 'button', className: 'btn', textContent: 'حفظ', onclick: async () => {
      const s = ls.get('adm_box'); try { await unseal(f.p0.value, s.box); } catch { return toast('كلمة المرور الحالية غير صحيحة'); }
      if (f.p1.value.length < 6) return toast('الجديدة 6 أحرف على الأقل'); if (f.p1.value !== f.p2.value) return toast('غير متطابقتين');
      s.box = await seal(f.p1.value, { token }); ls.set('adm_box', s); close(); toast('تم تغيير كلمة المرور ✅'); } })]);
}
async function openHistory() {
  const body = el('div', {}, el('div', { className: 'spin' }, el('i')));
  modal('سجل النشر', body, null);
  try {
    const cs = await gh(`/repos/${RP}/commits?sha=${BR}&per_page=12`);
    body.replaceChildren(el('p', { className: 'sub', style: 'color:var(--muted);font-size:13px;margin-bottom:8px', textContent: 'الاسترجاع يضع تلك النسخة في المسودة فقط، ولا يغيّر شيئاً حتى تضغط «نشر».' }),
      ...cs.map(c => el('div', { className: 'hist' }, el('div', { className: 'grow' }, c.commit.message.split('\n')[0], el('small', { textContent: new Date(c.commit.author.date).toLocaleString('ar-IQ') })),
        el('button', { type: 'button', className: 'btn ghost sm', textContent: 'استرجاع كمسودة', onclick: async () => { if (await confirmBox('استبدال مسودتك الحالية بهذه النسخة؟', 'استرجاع', false)) restoreFrom(c.sha); } }))));
  } catch (e) { body.replaceChildren(el('p', { className: 'err', textContent: e.message })); }
}
async function restoreFrom(sha) {
  try {
    const get = async f => { const r = await gh(`/repos/${RP}/contents/${f}?ref=${sha}`); return JSON.parse(dec.decode(unb64(r.content.replace(/\s/g, '')))); };
    const [cfg, products, pricelists, offers] = await Promise.all(FILES.map(get));
    offers.offers = offers.offers || []; offers.tiers = offers.tiers || [];
    D = { cfg, products, pricelists, offers }; D.products.forEach((p, i) => p._u = i + 5e5); nextU = D.products.length;
    // تُعامل كل الأصناف المسترجعة كتغييرات حتى يقارنها النظام بالنسخة الحالية
    const bmap = new Map(base.data.products.map((b, i) => [norm(b.name) + '::' + b.type, i]));
    D.products.forEach(p => { const i = bmap.get(norm(p.name) + '::' + p.type); if (i != null) p._u = i; });
    document.querySelectorAll('.layer').forEach(x => x.remove()); document.body.classList.remove('lock');
    touch(); drawTab(); toast('تم تحميل النسخة كمسودة — راجعها ثم انشر');
  } catch (e) { toast(e.message); }
}

// ---------- النشر ----------
function openPublish() {
  const ch = changes(), errs = validate();
  const body = [
    errs.length ? el('div', { className: 'warnbox' }, el('b', { textContent: 'يجب إصلاح الآتي قبل النشر:' }), el('ul', { className: 'chg' }, ...[...new Set(errs)].map(e => el('li', { textContent: e })))) : null,
    el('p', { style: 'font-weight:800;margin-bottom:6px', textContent: 'سيتم نشر التغييرات التالية للصيادلة:' }),
    el('ul', { className: 'chg' }, ...ch.map(c => el('li', { textContent: c }))),
    el('p', { style: 'color:var(--muted);font-size:13px;margin-top:10px', textContent: 'تظهر للصيادلة خلال دقيقة إلى دقيقتين من النشر. يمكنك الاسترجاع لاحقاً من «الإعدادات ← السجل».' })];
  modal('مراجعة ونشر', body, close => [
    el('button', { type: 'button', className: 'btn ghost', textContent: 'تجاهل كل التغييرات', onclick: async () => {
      if (await confirmBox('التراجع عن كل التعديلات غير المنشورة؟', 'تجاهل')) { close(); discard(); } } }),
    el('button', { type: 'button', className: 'btn', textContent: 'نشر الآن', disabled: !!errs.length, onclick: async function () {
      this.disabled = true; this.textContent = 'جارٍ النشر…';
      try { await publish(ch); close(); done(); } catch (e) { this.disabled = false; this.textContent = 'نشر الآن'; toast(e.message); if (e.conflict) { close(); conflictBox(); } } } })]);
}
function discard() {
  D = clone(base.data); D.products.forEach((p, i) => p._u = i); nextU = D.products.length; pending.clear(); delImgs.clear(); ls.del('adm_draft'); drawTab(); drawPub(); toast('تم تجاهل التعديلات');
}
function conflictBox() {
  modal('تعديل من مكان آخر', [el('p', { textContent: 'تم تعديل ملفات الكتالوج في GitHub من جهة أخرى بعد فتحك للوحة، ولذلك أوقفنا النشر حتى لا تُمحى تعديلاتها. حمّل أحدث نسخة ثم أعد تعديلاتك (يمكنك أولاً تنزيل نسخة احتياطية).' })], close => [
    el('button', { type: 'button', className: 'btn ghost', textContent: 'تنزيل مسودتي', onclick: () => { const b = new Blob([JSON.stringify(outFiles(), null, 2)], { type: 'application/json' }); const a = el('a', { href: URL.createObjectURL(b), download: 'my-draft.json' }); document.body.append(a); a.click(); a.remove(); } }),
    el('button', { type: 'button', className: 'btn', textContent: 'تحميل أحدث نسخة', onclick: async () => { close(); ls.del('adm_draft'); spinner(); await loadRepo(); renderApp(); } })]);
}
async function publish(ch) {
  const ref = await gh(`/repos/${RP}/git/ref/heads/${BR}`), latest = ref.object.sha;
  const lc = await gh(`/repos/${RP}/git/commits/${latest}`);
  if (latest !== base.commit) {   // تغيّر المستودع: تأكد أن ملفات البيانات لم تُمَس
    const tr = await gh(`/repos/${RP}/git/trees/${lc.tree.sha}?recursive=1`);
    for (const f of FILES) { const e = tr.tree.find(x => x.path === f); if (!e || e.sha !== base.shas[f]) throw Object.assign(new Error('تعارض: تغيّرت الملفات في GitHub'), { conflict: true }); }
  }
  const o = outFiles(), entries = [];
  for (const f of changedFiles()) entries.push({ path: f, mode: '100644', type: 'blob', content: JSON.stringify(o[f], null, 2) + '\n' });
  const used = new Set(D.products.map(p => p.image));
  for (const [name, im] of pending) {
    if (!used.has(name)) continue;
    for (const [dir, blob] of [['images/', im.full], ['thumbs/', im.thumb]]) {
      const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
      const bl = await gh(`/repos/${RP}/git/blobs`, 'POST', { content: data, encoding: 'base64' });
      entries.push({ path: dir + name, mode: '100644', type: 'blob', sha: bl.sha });
    }
  }
  for (const p of delImgs) if (!D.products.some(q => p.endsWith('/' + q.image))) entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
  if (!entries.length) throw new Error('لا توجد تغييرات للنشر');
  const tree = await gh(`/repos/${RP}/git/trees`, 'POST', { base_tree: lc.tree.sha, tree: entries });
  const msg = 'تحديث من لوحة المندوب: ' + (ch.map(c => c.replace(/^\S+\s/, '').split(':')[0]).slice(0, 3).join('، ') || 'تعديلات');
  const commit = await gh(`/repos/${RP}/git/commits`, 'POST', { message: msg, tree: tree.sha, parents: [latest] });
  await gh(`/repos/${RP}/git/refs/heads/${BR}`, 'PATCH', { sha: commit.sha });
  ls.del('adm_draft');
  await loadRepo();
}
function done() {
  renderApp();
  modal('تم النشر ✅', [el('p', { style: 'font-weight:700', textContent: 'حُفظت التعديلات في GitHub. ستظهر لجميع الصيادلة خلال دقيقة إلى دقيقتين.' }),
    el('p', { style: 'color:var(--muted);font-size:13.5px;margin-top:8px', textContent: 'إن كان التطبيق مفتوحاً عند أحدهم فسيأخذ الأسعار الجديدة عند فتحه التالي.' })], close => [
    el('a', { className: 'btn', href: './', target: '_blank', rel: 'noopener', textContent: 'فتح التطبيق', style: 'text-decoration:none' }), el('button', { type: 'button', className: 'btn ghost', textContent: 'إغلاق', onclick: close })]);
}

// ---------- التشغيل ----------
addEventListener('beforeunload', e => { if (token && base && changes().length) { persist(); } });
(function init() {
  if (!crypto || !crypto.subtle) { app().replaceChildren(el('div', { className: 'gate' }, el('p', { className: 'err', textContent: 'هذه الصفحة تتطلب اتصالاً آمناً (https).' }))); return; }
  ls.get('adm_box') ? renderLogin() : renderSetup();
})();
