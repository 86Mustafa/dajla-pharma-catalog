'use strict';
/* =====================================================================
   لوحة المندوب — تبويبا «الطلبات» و«المرتجعات» (Firestore عبر orders-api.js)
   تعتمد على أدوات admin.js: el, modal, toast, confirmBox, icon, ls, fmt, seal, unseal, D, token, fbCred, touch
   ===================================================================== */
const OrdersUI = (() => {
  const CK = 'adm_orders_v1', ACTIVE = ['new', 'preparing', 'ready', 'hold'], FINAL = ['delivered', 'cancelled'];
  const REASONS = ['قرب انتهاء الصلاحية', 'تالف / مكسور', 'خطأ في التجهيز', 'رفض الصيدلاني', 'أخرى'];
  const ST = () => OAPI.STATUS;
  let O = ls.get(CK, { pid: '', since: 0, docs: {} }), timer = null, busy = false, err = '';
  let filter = 'active', q = '', ui = null, RET = null, retQ = '', retUi = null;
  const save = () => ls.set(CK, O);
  const cur = () => (D.cfg.orders && D.cfg.orders.projectId) || '';
  const digits = s => String(s || '').replace(/\D/g, '');
  const waNum = p => { const d = digits(p); return d.startsWith('964') ? d : d.replace(/^0+/, '964'); };
  const when = ms => new Date(ms).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
  const ago = ms => { const m = Math.floor((Date.now() - ms) / 60000); if (m < 1) return 'الآن'; if (m < 60) return `منذ ${m} د`; const h = Math.floor(m / 60); return h < 24 ? `منذ ${h} س` : `منذ ${Math.floor(h / 24)} يوم`; };
  const late = d => ['new', 'preparing'].includes(d.status) && Date.now() - (d.createdAt || Date.now()) > 24 * 3600e3;
  const stop = () => { clearInterval(timer); timer = null; ui = null; retUi = null; sUi = null; };
  const start = fn => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && token) fn(); }, 20000); };

  async function ensure() {
    const c = D.cfg.orders;
    if (!c || !c.projectId || !c.apiKey) throw Object.assign(new Error('أدخل معرّف المشروع ومفتاح API في «الإعدادات ← نظام الطلبات»'), { cfg: true });
    if (!OAPI.cfg || OAPI.cfg.projectId !== c.projectId.trim() || OAPI.cfg.apiKey !== c.apiKey.trim()) OAPI.init(c);
    if (!fbCred) throw Object.assign(new Error('أدخل بريد وكلمة مرور Firebase في «الإعدادات ← نظام الطلبات»'), { cfg: true });
    if (!OAPI.loggedIn) await OAPI.login(fbCred.email, fbCred.password);
  }
  const notice = e => el('div', { className: 'box oc-err' }, el('b', { textContent: e.message || String(e) }),
    e.cfg ? el('button', { type: 'button', className: 'btn sm', textContent: 'فتح الإعدادات', onclick: () => { tab = 'settings'; drawTabs(); drawTab(); } }) : null);

  // ================= الطلبات =================
  async function refresh() {
    if (busy) return; busy = true;
    try {
      await ensure();
      if (O.pid !== cur()) O = { pid: cur(), since: 0, docs: {} };
      const from = O.since ? O.since - 1000 : Date.now() - 90 * 864e5;
      const rows = await OAPI.ordersSince(from);
      for (const d of rows) { O.docs[d.id] = d; O.since = Math.max(O.since, d.updatedAt || 0); }
      if (!O.since) O.since = Date.now() - 90 * 864e5;
      save(); err = '';
    } catch (e) { err = e; }
    finally { busy = false; drawOrders(); }
  }

  function tabOrders(m) {
    const U = ui = { sum: el('div', { className: 'oc-sum' }), chips: el('div', { className: 'chips' }), err: el('div'), list: el('div', { className: 'oc-list' }) };
    const s = el('input', { type: 'search', placeholder: 'ابحث: رقم الطلب أو اسم الصيدلية أو هاتفها…', value: q, oninput: e => { q = e.target.value.trim(); drawOrders(); } });
    m.append(U.sum, el('div', { className: 'fld' }, s), U.chips, U.err, U.list,
      el('div', { style: 'text-align:center;margin-top:10px' }, el('button', { type: 'button', className: 'btn ghost sm', textContent: '↻ تحديث الآن', onclick: refresh })));
    drawOrders(); refresh(); start(refresh);
  }

  function drawOrders() {
    if (!ui || !ui.list.isConnected) return;
    const all = Object.values(O.docs).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), cnt = {};
    for (const d of all) cnt[d.status] = (cnt[d.status] || 0) + 1;
    const nLate = all.filter(late).length, today0 = new Date().setHours(0, 0, 0, 0);
    const todayT = all.filter(d => (d.createdAt || 0) >= today0 && d.status !== 'cancelled').reduce((s, d) => s + (d.total || 0), 0);
    const tile = (k, n, label, color) => el('button', { type: 'button', className: 'tile' + (filter === k ? ' on' : ''), style: `--c:${color}`, onclick: () => { filter = k; drawOrders(); } }, el('b', { textContent: n }), el('span', { textContent: label }));
    ui.sum.replaceChildren(tile('new', cnt.new || 0, 'جديدة', ST().new.c), tile('preparing', cnt.preparing || 0, 'قيد التجهيز', ST().preparing.c),
      tile('ready', cnt.ready || 0, 'جاهزة', ST().ready.c), tile('hold', cnt.hold || 0, 'معلّقة', ST().hold.c), tile('late', nLate, 'متأخرة +24س', '#b91c1c'),
      el('div', { className: 'tile static' }, el('b', { textContent: fmt(todayT) }), el('span', { textContent: 'مبيعات اليوم' })));
    const F = [['active', 'النشطة'], ['all', 'الكل'], ['delivered', 'مُسلَّمة'], ['cancelled', 'ملغاة']];
    ui.chips.replaceChildren(...F.map(([k, t]) => el('button', { type: 'button', className: 'chip' + (filter === k ? ' on' : ''), textContent: t, onclick: () => { filter = k; drawOrders(); } })),
      ...(['new', 'preparing', 'ready', 'hold', 'late'].includes(filter) ? [el('button', { type: 'button', className: 'chip on', textContent: filter === 'late' ? 'المتأخرة' : ST()[filter].t, onclick: () => { filter = 'active'; drawOrders(); } })] : []));
    ui.err.replaceChildren(...(err ? [notice(err)] : []));
    let rows = all.filter(d => filter === 'all' ? true : filter === 'active' ? ACTIVE.includes(d.status) : filter === 'late' ? late(d) : d.status === filter);
    if (q) { const k = q.toLowerCase(); rows = rows.filter(d => (d.no + ' ' + ((d.cust || {}).name || '') + ' ' + ((d.cust || {}).phone || '')).toLowerCase().includes(k)); }
    ui.list.replaceChildren(...(rows.length ? rows.map(card) : [el('p', { className: 'oc-empty', textContent: err ? '' : (busy && !all.length ? 'جارٍ التحميل…' : 'لا توجد طلبات في هذا العرض') })]));
  }

  function card(d) {
    const S = ST()[d.status] || ST().new, c = d.cust || {};
    return el('article', { className: 'oc', onclick: () => openOrder(d.id) },
      el('div', { className: 'oc-h' }, el('b', { textContent: '#' + d.no }), el('span', { className: 'ord-st', style: `background:${S.c}`, textContent: S.ic + ' ' + S.t }),
        late(d) ? el('span', { className: 'ord-st', style: 'background:#b91c1c', textContent: 'متأخر' }) : null,
        d.items.some(i => i.prepared != null && i.prepared < i.qty) ? el('span', { className: 'ord-st', style: 'background:#b45309', textContent: 'جزئي' }) : null,
        sentWh(d.id) ? el('span', { className: 'ord-st', style: 'background:#0a6b53', textContent: '📤 للمذخر' }) : null),
      el('div', { className: 'oc-n', textContent: c.name || '—' }),
      el('div', { className: 'oc-m', textContent: `${ago(d.createdAt || Date.now())} · ${d.warehouse && d.warehouse.name ? 'مذخر ' + d.warehouse.name + ' · ' : ''}${d.items.length} صنف · ${fmt(d.total)} د.ع` }),
      d.status === 'hold' && d.holdReason ? el('div', { className: 'oc-hold', textContent: 'سبب التعليق: ' + d.holdReason }) : null);
  }

  function waMsg(d) {
    const S = ST()[d.status] || ST().new; let t = `مرحباً ${(d.cust || {}).name || ''}\nطلبك رقم #${d.no} — الحالة: ${S.t}`;
    if (d.status === 'hold' && d.holdReason) t += `\nالسبب: ${d.holdReason}`;
    const miss = d.items.filter(i => i.prepared != null && i.prepared < i.qty);
    if (miss.length) t += '\nالأصناف الناقصة:\n' + miss.map(i => `- ${i.name}: المطلوب ${i.qty}، المجهّز ${i.prepared}`).join('\n');
    if (d.repNote) t += `\nملاحظة: ${d.repNote}`;
    return t + '\nشكراً لك 🌿';
  }
  const openWa = d => { const n = waNum((d.cust || {}).phone); if (!n) return toast('لا يوجد رقم هاتف للصيدلية'); window.open(`https://wa.me/${n}?text=${encodeURIComponent(waMsg(d))}`, '_blank'); };

  function openOrder(id) {
    const d = O.docs[id]; if (!d) return;
    const c = d.cust || {}, S = ST()[d.status] || ST().new, w = JSON.parse(JSON.stringify(d.items));
    const note = el('textarea', { placeholder: 'ملاحظة تظهر للصيدلاني (اختياري)', value: d.repNote || '' });
    const whNote = el('textarea', { placeholder: 'ملاحظات التجهيز للمذخر — تظهر أسفل ملف PDF (اختياري)', value: d.whNote || '', rows: 3 });
    const rows = w.map((it, i) => el('div', { className: 'oi' }, el('div', { className: 'oi-n' }, el('b', { textContent: it.name }), el('small', { textContent: `المطلوب ${it.qty} × ${fmt(it.price || 0)}` })),
      el('input', { type: 'number', min: 0, max: it.qty, inputMode: 'numeric', placeholder: String(it.qty), value: it.prepared == null ? '' : it.prepared, attrs: { 'aria-label': 'الكمية المجهّزة' },
        oninput: e => { const v = e.target.value; it.prepared = v === '' ? null : Math.max(0, Math.min(it.qty, Number(v))); } })));
    const all = el('button', { type: 'button', className: 'btn ghost sm', textContent: 'جهّز الكل', onclick: () => { w.forEach((it, i) => { it.prepared = it.qty; }); body.querySelectorAll('.oi input').forEach((x, i) => { x.value = w[i].qty; }); } });
    const act = (label, status, cls = '', needReason) => el('button', { type: 'button', className: 'btn sm ' + cls, textContent: label, onclick: async function () {
      let reason = '';
      if (needReason) { const r = await askText(needReason === 'hold' ? 'سبب التعليق (يراه الصيدلاني)' : 'سبب الإلغاء (يراه الصيدلاني)'); if (r == null) return; reason = r; }
      this.disabled = true;
      try {
        const items = w.map(i => ({ ...i, prepared: ['ready', 'delivered'].includes(status) && i.prepared == null ? i.qty : i.prepared }));
        const patch = { status, items, repNote: note.value.trim(), whNote: whNote.value.trim(), holdReason: status === 'hold' ? reason : '', history: [...(d.history || []), { s: status, at: Date.now(), note: reason }] };
        await ensure(); await OAPI.updateOrder(d.id, patch);
        O.docs[d.id] = { ...d, ...patch, updatedAt: Date.now() }; save(); drawOrders(); close(); toast('تم تحديث الحالة ✅');
        if (await confirmBox(`أصبحت حالة الطلب «${ST()[status].t}». هل تريد إبلاغ الصيدلاني عبر واتساب؟`, 'فتح واتساب', false)) openWa(O.docs[d.id]);
      } catch (e) { this.disabled = false; toast(e.message); }
    } });
    const A = { new: [['بدء التجهيز', 'preparing'], ['جاهز', 'ready'], ['تعليق', 'hold', 'ghost', 'hold'], ['إلغاء', 'cancelled', 'danger', 'cancel']],
      preparing: [['جاهز للتسليم', 'ready'], ['تعليق', 'hold', 'ghost', 'hold'], ['إلغاء', 'cancelled', 'danger', 'cancel']],
      ready: [['تم التسليم', 'delivered'], ['رجوع للتجهيز', 'preparing', 'ghost'], ['تعليق', 'hold', 'ghost', 'hold']],
      hold: [['استئناف التجهيز', 'preparing'], ['جاهز', 'ready'], ['إلغاء', 'cancelled', 'danger', 'cancel']],
      delivered: [['إعادة فتح (جاهز)', 'ready', 'ghost']], cancelled: [['إعادة فتح (جديد)', 'new', 'ghost']] }[d.status] || [];
    const body = el('div', {},
      el('div', { className: 'box' }, el('div', { className: 'oc-h' }, el('span', { className: 'ord-st', style: `background:${S.c}`, textContent: S.ic + ' ' + S.t }), el('small', { textContent: when(d.createdAt || Date.now()) })),
        el('p', { style: 'font-weight:800;margin-top:8px', textContent: c.name || '—' }),
        c.phone ? el('p', {}, el('a', { href: 'tel:' + digits(c.phone), className: 'lnk', textContent: '📞 ' + c.phone, style: 'direction:ltr;display:inline-block' })) : null,
        c.address ? el('p', { textContent: '📍 ' + c.address }) : null, c.notes ? el('p', { textContent: '📝 ' + c.notes }) : null,
        el('p', { style: 'color:var(--muted);font-size:13px', textContent: `${d.warehouse && d.warehouse.name ? 'مذخر ' + d.warehouse.name + ' · ' : ''}المجموع ${fmt(d.total)} د.ع` })),
      el('div', { className: 'oi-head' }, el('b', { textContent: 'الأصناف — اكتب الكمية المجهّزة' }), all), ...rows,
      el('div', { className: 'fld', style: 'margin-top:12px' }, note),
      el('div', { className: 'acts' }, ...A.map(a => act(...a))),
      el('div', { className: 'acts' }, el('button', { type: 'button', className: 'btn ghost sm', textContent: '💬 إبلاغ الصيدلاني', onclick: () => openWa({ ...d, repNote: note.value.trim(), items: w }) }),
        el('button', { type: 'button', className: 'btn ghost sm', textContent: '↩ مرتجع لهذه الصيدلية', onclick: () => { close(); tab = 'returns'; drawTabs(); drawTab(); openReturn(null, { pharmacy: c.name, phone: c.phone, orderNo: d.no }); } })),
      el('div', { className: 'fld', style: 'margin-top:12px' }, el('label', { textContent: '📝 ملاحظات التجهيز للمذخر' }), whNote),
      el('div', { className: 'acts' }, el('button', { type: 'button', className: 'btn sm', textContent: '📤 إرسال للمذخر (PDF)', onclick: function () { sendToWarehouse({ ...d, whNote: whNote.value.trim(), items: w.map(i => ({ ...i })) }, this); } }),
        el('button', { type: 'button', className: 'btn ghost sm', textContent: '⬇ تنزيل PDF', onclick: function () { sendToWarehouse({ ...d, whNote: whNote.value.trim(), items: w.map(i => ({ ...i })) }, this, true); } })),
      sentWh(d.id) ? el('p', { style: 'font-size:12.5px;color:var(--brand-d);margin-top:6px', textContent: '✅ أُرسل للمذخر ' + when(sentWh(d.id)) }) : null,
      el('div', { className: 'oi-head', style: 'margin-top:14px' }, el('b', { textContent: 'السجل' })),
      el('ol', { className: 'ord-tl' }, ...(d.history || []).map(h => el('li', {}, (ST()[h.s] || {}).t || h.s, el('small', { textContent: ' · ' + when(h.at) + (h.note ? ' — ' + h.note : '') })))));
    const close = modal('طلب #' + d.no, [body], cl => [el('button', { type: 'button', className: 'btn ghost danger-t', textContent: 'حذف الطلب', onclick: async () => {
      if (!await confirmBox('حذف الطلب نهائياً من قاعدة البيانات؟ (لا يمكن التراجع، ولا يظهر عند الصيدلاني)', 'حذف')) return;
      try { await ensure(); await OAPI.deleteOrder(d.id); delete O.docs[d.id]; save(); drawOrders(); cl(); toast('تم الحذف'); } catch (e) { toast(e.message); } } }),
      el('button', { type: 'button', className: 'btn ghost', textContent: 'إغلاق', onclick: cl })]);
  }
  function askText(title) {
    return new Promise(res => {
      let done = false; const fin = v => { if (!done) { done = true; res(v); } };
      const inp = el('input', { placeholder: 'اكتب السبب…' });
      modal(title, [el('div', { className: 'fld' }, inp)], cl => [el('button', { type: 'button', className: 'btn ghost', textContent: 'إلغاء', onclick: () => { fin(null); cl(); } }),
        el('button', { type: 'button', className: 'btn', textContent: 'تأكيد', onclick: () => { fin(inp.value.trim()); cl(); } })], () => fin(null));
      setTimeout(() => inp.focus(), 80);
    });
  }

  // ================= المرتجعات =================
  async function loadRet() {
    try { await ensure(); RET = await OAPI.listReturns(); err = ''; } catch (e) { err = e; }
    drawRet();
  }
  function tabReturns(m) {
    const U = retUi = { sum: el('div', { className: 'oc-sum' }), err: el('div'), list: el('div', { className: 'oc-list' }) };
    const s = el('input', { type: 'search', placeholder: 'ابحث باسم الصيدلية أو الصنف…', value: retQ, oninput: e => { retQ = e.target.value.trim(); drawRet(); } });
    m.append(el('div', { className: 'rowline' }, el('button', { type: 'button', className: 'btn', style: 'flex:1', textContent: '+ مرتجع جديد', onclick: () => openReturn() }),
      el('button', { type: 'button', className: 'btn ghost', textContent: '↻', attrs: { 'aria-label': 'تحديث' }, onclick: loadRet })), U.sum, el('div', { className: 'fld' }, s), U.err, U.list);
    drawRet(); loadRet();
  }
  function drawRet() {
    if (!retUi || !retUi.list.isConnected) return;
    retUi.err.replaceChildren(...(err && !RET ? [notice(err)] : []));
    const all = RET || [], m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
    const mon = all.filter(r => r.date >= m0.getTime());
    retUi.sum.replaceChildren(el('div', { className: 'tile static' }, el('b', { textContent: mon.length }), el('span', { textContent: 'دفعات هذا الشهر' })),
      el('div', { className: 'tile static' }, el('b', { textContent: fmt(mon.reduce((s, r) => s + (r.total || 0), 0)) }), el('span', { textContent: 'قيمة مرتجعات الشهر' })),
      el('div', { className: 'tile static' }, el('b', { textContent: all.length }), el('span', { textContent: 'كل الدفعات' })));
    let rows = all; if (retQ) { const k = retQ.toLowerCase(); rows = rows.filter(r => (r.pharmacy + ' ' + r.items.map(i => i.name).join(' ')).toLowerCase().includes(k)); }
    retUi.list.replaceChildren(...(rows.length ? rows.map(r => el('article', { className: 'oc', onclick: () => openReturn(r) },
      el('div', { className: 'oc-h' }, el('b', { textContent: r.pharmacy }), el('small', { textContent: new Date(r.date).toLocaleDateString('ar-IQ') }), r.orderNo ? el('small', { textContent: 'طلب #' + r.orderNo }) : null),
      el('ul', { className: 'oc-it' }, ...r.items.map(i => el('li', { textContent: `${i.name} × ${i.qty} — ${i.reason}` }))),
      el('div', { className: 'oc-m', textContent: `القيمة: ${fmt(r.total || 0)} د.ع` }))) : [el('p', { className: 'oc-empty', textContent: err ? '' : (RET ? 'لا توجد مرتجعات' : 'جارٍ التحميل…') })]));
  }
  function openReturn(r, pre) {
    const R = r ? JSON.parse(JSON.stringify(r)) : { id: OAPI.newId(), createdMs: Date.now(), date: new Date().setHours(12, 0, 0, 0), pharmacy: (pre && pre.pharmacy) || '', phone: (pre && pre.phone) || '', orderNo: (pre && pre.orderNo) || '', note: '', items: [], total: 0 };
    const known = [...new Set([...Object.values(O.docs).map(d => (d.cust || {}).name), ...(RET || []).map(x => x.pharmacy)].filter(Boolean))];
    const dl = el('datalist', { id: 'ph_dl' }, ...known.map(n => el('option', { value: n }))), pl = el('datalist', { id: 'pr_dl' }, ...D.products.map(p => el('option', { value: p.name.trim() })));
    const ph = el('input', { value: R.pharmacy, attrs: { list: 'ph_dl' }, placeholder: 'اسم الصيدلية', oninput: e => { R.pharmacy = e.target.value.trim();
      const o = Object.values(O.docs).find(d => (d.cust || {}).name === R.pharmacy); if (o && !tel.value) { tel.value = R.phone = o.cust.phone || ''; } } });
    const tel = el('input', { className: 'ltr', inputMode: 'tel', value: R.phone, placeholder: '07xx', oninput: e => { R.phone = e.target.value.trim(); } });
    const dt = el('input', { type: 'date', value: new Date(R.date).toISOString().slice(0, 10), onchange: e => { R.date = new Date(e.target.value + 'T12:00:00').getTime(); } });
    const on = el('input', { className: 'ltr', inputMode: 'numeric', value: R.orderNo, placeholder: 'اختياري', oninput: e => { R.orderNo = e.target.value.trim(); } });
    const note = el('textarea', { value: R.note, placeholder: 'ملاحظات (اختياري)', oninput: e => { R.note = e.target.value; } });
    const tot = el('b'), lines = el('div', {});
    const sum = () => { R.total = R.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.value) || 0), 0); tot.textContent = fmt(R.total) + ' د.ع'; };
    const drawLines = () => {
      lines.replaceChildren(...R.items.map((it, i) => el('div', { className: 'rl' },
        el('div', { className: 'rl-1' }, el('input', { attrs: { list: 'pr_dl' }, value: it.name, placeholder: 'اسم المادة', oninput: e => { it.name = e.target.value.trim(); const p = D.products.find(x => x.name.trim() === it.name); if (p && !it.value) { it.value = p.price; if (it._v) it._v.value = p.price; sum(); } } }),
          el('button', { type: 'button', className: 'ib del', attrs: { 'aria-label': 'حذف السطر' }, onclick: () => { R.items.splice(i, 1); drawLines(); sum(); } }, icon('trash'))),
        el('div', { className: 'rl-2' }, el('input', { type: 'number', min: 1, inputMode: 'numeric', placeholder: 'الكمية', value: it.qty || '', oninput: e => { it.qty = Number(e.target.value); sum(); } }),
          (it._v = el('input', { type: 'number', min: 0, inputMode: 'numeric', placeholder: 'سعر الوحدة', value: it.value || '', oninput: e => { it.value = Number(e.target.value); sum(); } })),
          el('select', { onchange: e => { it.reason = e.target.value; } }, ...REASONS.map(x => el('option', { value: x, textContent: x, selected: x === it.reason })))))));
    };
    const addLine = () => { R.items.push({ name: '', qty: 1, value: 0, reason: REASONS[0] }); drawLines(); sum(); };
    if (!R.items.length) addLine(); else { drawLines(); sum(); }
    const fld = (l, i) => el('div', { className: 'fld' }, el('label', { textContent: l }), i);
    modal(r ? 'تعديل مرتجع' : 'مرتجع جديد', [dl, pl, fld('الصيدلية', ph), fld('الهاتف', tel), fld('التاريخ', dt), fld('رقم الطلب المرتبط', on),
      el('div', { className: 'oi-head' }, el('b', { textContent: 'المواد المرتجعة' }), el('button', { type: 'button', className: 'btn ghost sm', textContent: '+ مادة', onclick: addLine })), lines,
      el('div', { className: 'oi-head' }, el('b', { textContent: 'القيمة الإجمالية' }), tot), fld('ملاحظات', note)], cl => [
      r ? el('button', { type: 'button', className: 'btn ghost danger-t', textContent: 'حذف', onclick: async () => { if (!await confirmBox('حذف هذه الدفعة من المرتجعات؟', 'حذف')) return;
        try { await ensure(); await OAPI.deleteReturn(R.id); RET = (RET || []).filter(x => x.id !== R.id); drawRet(); cl(); toast('تم الحذف'); } catch (e) { toast(e.message); } } }) : el('button', { type: 'button', className: 'btn ghost', textContent: 'إلغاء', onclick: cl }),
      el('button', { type: 'button', className: 'btn', textContent: 'حفظ', onclick: async function () {
        const items = R.items.filter(i => i.name && Number(i.qty) > 0).map(i => ({ name: i.name, qty: Number(i.qty), value: Number(i.value) || 0, reason: i.reason || REASONS[0] }));
        if (!R.pharmacy) return toast('اكتب اسم الصيدلية'); if (!items.length) return toast('أضف مادة واحدة على الأقل بكمية');
        const doc = { id: R.id, createdMs: R.createdMs, date: R.date, pharmacy: R.pharmacy, phone: R.phone, orderNo: R.orderNo, note: R.note, items, total: items.reduce((s, i) => s + i.qty * i.value, 0) };
        this.disabled = true;
        try { await ensure(); await OAPI.saveReturn(doc); RET = [doc, ...(RET || []).filter(x => x.id !== doc.id)].sort((a, b) => b.createdMs - a.createdMs); drawRet(); cl(); toast('تم حفظ المرتجع ✅'); }
        catch (e) { this.disabled = false; toast(e.message); }
      } })]);
  }


  // ================= الكشوفات (كشف حساب الصيدليات) =================
  const itemsVal = d => d.items.reduce((s, i) => s + (i.prepared == null ? i.qty : i.prepared) * (i.price || 0), 0);
  let sp = 'this', sFrom = '', sTo = '', sQ = '', sUi = null;
  const rangeOf = () => {
    const n = new Date(), m0 = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
    if (sp === 'this') return [m0, Infinity];
    if (sp === 'last') return [new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), m0 - 1];
    if (sp === '30') return [Date.now() - 30 * 864e5, Infinity];
    return [sFrom ? new Date(sFrom + 'T00:00:00').getTime() : 0, sTo ? new Date(sTo + 'T23:59:59').getTime() : Infinity];
  };
  function statRows() {
    const [a, b] = rangeOf(), M = new Map();
    const row = n => { n = (n || '—').trim(); if (!M.has(n)) M.set(n, { name: n, phone: '', orders: [], rets: [], n: 0, ordered: 0, delivered: 0, pending: 0, ret: 0 }); return M.get(n); };
    for (const d of Object.values(O.docs)) {
      const t = d.createdAt || 0; if (t < a || t > b || d.status === 'cancelled') continue;
      const r = row((d.cust || {}).name); r.phone = r.phone || (d.cust || {}).phone || ''; r.orders.push(d); r.n++; r.ordered += d.total || 0;
      if (d.status === 'delivered') r.delivered += itemsVal(d); else r.pending += itemsVal(d);
    }
    for (const x of RET || []) { if (x.date < a || x.date > b) continue; const r = row(x.pharmacy); r.phone = r.phone || x.phone || ''; r.rets.push(x); r.ret += x.total || 0; }
    for (const r of M.values()) r.net = r.delivered - r.ret;
    return [...M.values()].sort((x, y) => y.net - x.net);
  }
  const periodLabel = () => ({ this: 'هذا الشهر', last: 'الشهر الماضي', '30': 'آخر 30 يوماً' }[sp] || `${sFrom || '…'} إلى ${sTo || '…'}`);
  function tabStatement(m) {
    const U = sUi = { sum: el('div', { className: 'oc-sum' }), err: el('div'), list: el('div', { className: 'oc-list' }) };
    const P = [['this', 'هذا الشهر'], ['last', 'الشهر الماضي'], ['30', 'آخر 30 يوماً'], ['custom', 'مخصّص']];
    const chips = el('div', { className: 'chips' }), cust = el('div', { className: 'rowline', hidden: sp !== 'custom' },
      el('div', { className: 'fld', style: 'flex:1' }, el('label', { textContent: 'من' }), el('input', { type: 'date', value: sFrom, onchange: e => { sFrom = e.target.value; drawStat(); } })),
      el('div', { className: 'fld', style: 'flex:1' }, el('label', { textContent: 'إلى' }), el('input', { type: 'date', value: sTo, onchange: e => { sTo = e.target.value; drawStat(); } })));
    const dc = () => chips.replaceChildren(...P.map(([k, t]) => el('button', { type: 'button', className: 'chip' + (sp === k ? ' on' : ''), textContent: t, onclick: () => { sp = k; cust.hidden = k !== 'custom'; dc(); drawStat(); } })));
    dc();
    const s = el('input', { type: 'search', placeholder: 'ابحث باسم الصيدلية…', value: sQ, oninput: e => { sQ = e.target.value.trim(); drawStat(); } });
    m.append(chips, cust, U.sum, el('div', { className: 'fld' }, s), U.err, U.list,
      el('div', { className: 'acts' }, el('button', { type: 'button', className: 'btn ghost sm', textContent: '⬇ تصدير الكل Excel (CSV)', onclick: () => exportCsv(statRows()) }),
        el('button', { type: 'button', className: 'btn ghost sm', textContent: '🖨 طباعة / PDF', onclick: () => printStat(statRows()) })),
      el('p', { style: 'font-size:12px;color:var(--muted);margin-top:8px', textContent: 'الطلبات المحفوظة على الجهاز هي آخر 90 يوماً. المُسلَّم = قيمة الأصناف المجهّزة فعلياً للطلبات بحالة «تم التسليم». الصافي = المُسلَّم − المرتجعات.' }));
    drawStat(); loadStat(); start(loadStat);
  }
  async function loadStat() { await refresh(); try { await ensure(); RET = await OAPI.listReturns(); } catch (e) { if (!err) err = e; } drawStat(); }
  function drawStat() {
    if (!sUi || !sUi.list.isConnected) return;
    sUi.err.replaceChildren(...(err ? [notice(err)] : []));
    const rows = statRows(), T = rows.reduce((t, r) => ({ n: t.n + r.n, d: t.d + r.delivered, p: t.p + r.pending, r: t.r + r.ret }), { n: 0, d: 0, p: 0, r: 0 });
    const tile = (n, l, c) => el('div', { className: 'tile static', style: c ? `--c:${c}` : '' }, el('b', { textContent: n }), el('span', { textContent: l }));
    sUi.sum.replaceChildren(tile(T.n, 'طلبات'), tile(fmt(T.d), 'مُسلَّم'), tile(fmt(T.p), 'غير مُسلَّم'), tile(fmt(T.r), 'مرتجعات'), tile(fmt(T.d - T.r), 'الصافي'), tile(rows.length, 'صيدليات'));
    const k = sQ.toLowerCase(), list = k ? rows.filter(r => r.name.toLowerCase().includes(k)) : rows;
    sUi.list.replaceChildren(...(list.length ? list.map(r => el('article', { className: 'oc', onclick: () => openStatement(r) },
      el('div', { className: 'oc-h' }, el('b', { textContent: r.name }), el('small', { textContent: `${r.n} طلب` })),
      el('div', { className: 'oc-m', textContent: `مُسلَّم ${fmt(r.delivered)} · غير مُسلَّم ${fmt(r.pending)} · مرتجعات ${fmt(r.ret)}` }),
      el('div', { className: 'oc-n', textContent: `الصافي: ${fmt(r.net)} د.ع` }))) : [el('p', { className: 'oc-empty', textContent: 'لا توجد بيانات في هذه الفترة' })]));
  }
  const stText = r => `كشف حساب — ${r.name}\nالفترة: ${periodLabel()}\n\nالطلبات: ${r.n}\nالمُسلَّم: ${fmt(r.delivered)} د.ع\nغير المُسلَّم: ${fmt(r.pending)} د.ع\nالمرتجعات: ${fmt(r.ret)} د.ع\n*الصافي: ${fmt(r.net)} د.ع*\n\nشكراً لتعاملكم 🌿`;
  function openStatement(r) {
    const line = d => el('li', {}, `#${d.no} · ${new Date(d.createdAt).toLocaleDateString('ar-IQ')} · ${(ST()[d.status] || {}).t} · ${fmt(itemsVal(d))}`);
    modal('كشف: ' + r.name, [
      el('p', { style: 'color:var(--muted);font-size:13px;margin-bottom:8px', textContent: periodLabel() }),
      el('div', { className: 'oc-sum' }, ...[['مُسلَّم', fmt(r.delivered)], ['غير مُسلَّم', fmt(r.pending)], ['مرتجعات', fmt(r.ret)], ['الصافي', fmt(r.net)]].map(([l, v]) => el('div', { className: 'tile static' }, el('b', { textContent: v }), el('span', { textContent: l })))),
      el('div', { className: 'oi-head' }, el('b', { textContent: `الطلبات (${r.orders.length})` })), el('ul', { className: 'oc-it' }, ...r.orders.sort((a, b) => b.createdAt - a.createdAt).map(line)),
      el('div', { className: 'oi-head' }, el('b', { textContent: `المرتجعات (${r.rets.length})` })),
      el('ul', { className: 'oc-it' }, ...r.rets.map(x => el('li', {}, `${new Date(x.date).toLocaleDateString('ar-IQ')} · ${x.items.map(i => i.name + ' ×' + i.qty).join('، ')} · ${fmt(x.total || 0)}`)))],
      cl => [el('button', { type: 'button', className: 'btn ghost', textContent: '💬 واتساب', onclick: () => { const n = waNum(r.phone); if (!n) return toast('لا يوجد رقم هاتف'); window.open(`https://wa.me/${n}?text=${encodeURIComponent(stText(r))}`, '_blank'); } }),
        el('button', { type: 'button', className: 'btn ghost', textContent: '🖨 PDF', onclick: () => { cl(); printStat([r]); } }),
        el('button', { type: 'button', className: 'btn', textContent: 'إغلاق', onclick: cl })]);
  }
  function exportCsv(rows) {
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = '﻿' + ['الصيدلية,الهاتف,عدد الطلبات,المُسلَّم,غير المُسلَّم,المرتجعات,الصافي', ...rows.map(r => [q(r.name), q(r.phone), r.n, r.delivered, r.pending, r.ret, r.net].join(','))].join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `statements-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove(); toast('تم تنزيل الملف — يفتح في Excel');
  }
  function printStat(rows) {
    const box = el('div', { id: 'prn' }, el('h1', { textContent: rows.length === 1 ? 'كشف حساب — ' + rows[0].name : 'كشف حسابات الصيدليات' }),
      el('p', { textContent: 'الفترة: ' + periodLabel() + ' — ' + new Date().toLocaleDateString('ar-IQ') }),
      el('table', {}, el('thead', {}, el('tr', {}, ...['الصيدلية', 'الطلبات', 'المُسلَّم', 'غير المُسلَّم', 'المرتجعات', 'الصافي'].map(t => el('th', { textContent: t })))),
        el('tbody', {}, ...rows.map(r => el('tr', {}, el('td', { textContent: r.name }), el('td', { textContent: r.n }), el('td', { textContent: fmt(r.delivered) }), el('td', { textContent: fmt(r.pending) }), el('td', { textContent: fmt(r.ret) }), el('td', { textContent: fmt(r.net) })))),
        rows.length > 1 ? el('tfoot', {}, el('tr', {}, el('td', { textContent: 'المجموع' }), el('td', { textContent: rows.reduce((s, r) => s + r.n, 0) }), ...['delivered', 'pending', 'ret', 'net'].map(k => el('td', { textContent: fmt(rows.reduce((s, r) => s + r[k], 0)) })))) : null));
    document.body.append(box); document.body.classList.add('printing');
    const done = () => { box.remove(); document.body.classList.remove('printing'); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done); setTimeout(() => window.print(), 60);
  }


  // ================= إرسال الطلب إلى مجموعة المذخر (جدول PDF) =================
  // واتساب لا يسمح لأي موقع بإرسال ملف إلى مجموعة تلقائياً؛ لذلك نُنشئ الـ PDF ونفتح قائمة المشاركة (على الهاتف)
  // فتختار مجموعة المذخر وترسل. على الحاسوب يُنزَّل الملف ويُفتح رابط المجموعة إن حفظته.
  const WG = 'adm_wgroups', WS = 'adm_sentwh';
  const sentWh = id => (ls.get(WS, {}))[id];
  const markSent = id => { const s = ls.get(WS, {}); s[id] = Date.now(); ls.set(WS, s); };
  const hasAr = s => /[؀-ۿ]/.test(s);

  async function makeOrderPdf(d) {
    const W = 1240, H = 1754, MX = 70, G = '#0f9d7a', GD = '#0a6b53', GL = '#e3f4ee', INK = '#0d1f1a', MUT = '#587369';
    await Promise.all(['700 30px Cairo', '500 26px Cairo', '800 40px Cairo'].map(f => document.fonts.load(f, 'أ A1').catch(() => {})));
    const logo = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = (D.cfg.brand && D.cfg.brand.logo) || 'icons/logo.png'; });
    const c = (d.cust || {}), wh = (d.warehouse && d.warehouse.name) || '', brand = (D.cfg.brand && D.cfg.brand.name) || '';
    const cols = [['م', 56, 'c'], ['المادة', 344, 'r'], ['النوع', 110, 'c'], ['التغليف', 110, 'c'], ['الكمية', 110, 'c'], ['السعر', 130, 'c'], ['المجموع', 160, 'c'], ['✓', 80, 'c']];
    const cats = D.cfg.categories || {};
    const typeOf = it => {
      let t = it.type;
      if (!t) { const m = String(it.id || '').match(/_([a-z]+)(?:_\d+)?$/); if (m && cats[m[1]]) t = m[1]; }
      if (!t) { const p = (D.products || []).find(x => x.name.trim() === it.name.trim()); if (p) t = p.type; }
      return t ? (cats[t] || t) : '—';
    };
    const splitName = n => { n = String(n).trim(); const m = n.match(/[\s(]*(باكيت|بدون)[\s)]*$/); return m ? [n.slice(0, m.index).replace(/\s*\/\s*$/, '').replace(/[\s(]+$/, '').trim() || n, m[1]] : [n, '—']; };
    const num = n => Number(n || 0).toLocaleString('en-US');
    const RH = 58, items = d.items, pages = [];
    const wrap = (txt, maxW, font) => { const m = document.createElement('canvas').getContext('2d'); m.font = font; const out = []; for (const para of String(txt).split(/\n/)) { let line = ''; for (const wd of para.split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + wd : wd; if (line && m.measureText(t).width > maxW) { out.push(line); line = wd; } else line = t; } out.push(line); } return out; };
    const noteLines = [];
    if (d.whNote) wrap(d.whNote, W - 2 * MX - 60, '500 27px Cairo, sans-serif').forEach(l => noteLines.push(l));
    const pharmNote = (c.notes || '').trim(), pharmLines = pharmNote ? wrap(pharmNote, W - 2 * MX - 60, '500 27px Cairo, sans-serif') : [];
    const NL = 40, noteH = (noteLines.length || pharmLines.length) ? 24 + 46 + (noteLines.length ? noteLines.length * NL + 10 : 0) + (pharmLines.length ? 40 + pharmLines.length * NL : 0) + 20 : 0;
    let idx = 0, pageNo = 0;
    const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.textBaseline = 'middle'; return [cv, x]; };
    const T = (x, s, px, py, { size = 28, w = 500, col = INK, al = 'right', maxW } = {}) => {
      s = String(s ?? ''); x.fillStyle = col; let sz = size; x.font = `${w} ${sz}px Cairo, sans-serif`;
      x.direction = hasAr(s) ? 'rtl' : 'ltr'; x.textAlign = al;
      while (maxW && x.measureText(s).width > maxW && sz > 18) { sz -= 2; x.font = `${w} ${sz}px Cairo, sans-serif`; }
      if (maxW) while (x.measureText(s).width > maxW && s.length > 3) s = s.slice(0, -2);
      x.fillText(s, px, py);
    };
    const rr = (x, a, b, w, h, r, fill, stroke) => { x.beginPath(); x.roundRect(a, b, w, h, r); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.strokeStyle = stroke; x.lineWidth = 2; x.stroke(); } };
    const head = x => {
      const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, GD); g.addColorStop(1, G); x.fillStyle = g; x.fillRect(0, 0, W, 190);
      if (logo) x.drawImage(logo, MX, 40, 110, 110);
      T(x, brand, W - MX, 75, { size: 38, w: 800, col: '#fff' }); T(x, 'طلب تجهيز من المذخر' + (wh ? ': ' + wh : ''), W - MX, 130, { size: 30, w: 600, col: '#d9f5ec' });
    };
    const tHead = (x, y) => {
      rr(x, MX, y, W - 2 * MX, 62, 12, GD); let cx = W - MX;
      for (const [t, w, a] of cols) { T(x, t, a === 'c' ? cx - w / 2 : cx - 14, y + 31, { size: 26, w: 700, col: '#fff', al: a === 'c' ? 'center' : 'right' }); cx -= w; }
      return y + 62;
    };
    const row = (x, it, i, y) => {
      if (i % 2) { x.fillStyle = '#f3faf7'; x.fillRect(MX, y, W - 2 * MX, RH); }
      x.strokeStyle = '#d7e6df'; x.lineWidth = 1.5; x.strokeRect(MX, y, W - 2 * MX, RH);
      const [nm, pk] = splitName(it.name), cells = [String(i + 1), nm, typeOf(it), pk, String(it.qty), num(it.price), num(it.qty * it.price), '☐']; let cx = W - MX;
      cols.forEach(([, w, a], k) => { T(x, cells[k], a === 'c' ? cx - w / 2 : cx - 14, y + RH / 2, { size: k === 4 ? 32 : 27, w: k === 4 ? 800 : 500, al: a === 'c' ? 'center' : 'right', maxW: a === 'c' ? w - 12 : w - 28 }); cx -= w; });
      return y + RH;
    };
    while (true) {
      const [cv, x] = mk(); pages.push(cv); pageNo++; let y;
      if (pageNo === 1) {
        head(x); y = 225;
        rr(x, MX, y, W - 2 * MX, 235, 18, GL);
        const L = (lab, val, px, py, mw) => { T(x, lab, px, py, { size: 24, col: MUT, w: 600 }); T(x, val, px, py + 36, { size: 30, w: 700, maxW: mw }); };
        L('رقم الطلب', '#' + d.no, W - MX - 24, y + 36, 380); L('التاريخ', new Date(d.createdAt || d.localMs || Date.now()).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }), W - MX - 24, y + 130, 480);
        L('الصيدلية', c.name || '—', W / 2 - 10, y + 36, 470); L('الهاتف', c.phone || '—', W / 2 - 10, y + 130, 470);
        T(x, c.address ? '📍 ' + c.address : '', MX + 24, y + 200, { size: 24, col: MUT, maxW: 480, al: 'left' });
        y += 265;
      } else { head(x); y = 225; }
      y = tHead(x, y);
      const bottom = H - 130;
      while (idx < items.length && y + RH <= bottom - (idx === items.length - 1 ? 110 + noteH : 0)) { y = row(x, items[idx], idx, y); idx++; }
      if (idx >= items.length) {
        const tot = items.reduce((s, i) => s + i.qty * i.price, 0), q = items.reduce((s, i) => s + i.qty, 0);
        rr(x, MX, y + 14, W - 2 * MX, 70, 12, GL);
        T(x, `عدد الأصناف: ${items.length}   ·   مجموع الكميات: ${q}`, W - MX - 24, y + 49, { size: 27, w: 700 });
        T(x, 'المجموع: ' + num(tot) + ' د.ع', MX + 24, y + 49, { size: 30, w: 800, col: GD, al: 'left' });
        if (noteH) {
          const by = y + 100; rr(x, MX, by, W - 2 * MX, noteH, 14, '#fff7ef', '#f2a36b'); let ty = by + 40;
          if (noteLines.length) { T(x, 'ملاحظات التجهيز', W - MX - 30, ty, { size: 28, w: 800, col: '#b45309' }); ty += 46; noteLines.forEach(l => { T(x, l, W - MX - 30, ty, { size: 27 }); ty += NL; }); ty += 10; }
          if (pharmLines.length) { T(x, 'ملاحظة الصيدلية', W - MX - 30, ty, { size: 26, w: 700, col: MUT }); ty += 40; pharmLines.forEach(l => { T(x, l, W - MX - 30, ty, { size: 26, col: MUT }); ty += NL; }); }
        }
        break;
      }
    }
    pages.forEach((cv, i) => { const x = cv.getContext('2d'); x.direction = 'rtl'; x.textAlign = 'center'; x.fillStyle = MUT; x.font = '500 22px Cairo, sans-serif'; x.fillText(`صفحة ${i + 1} من ${pages.length}  ·  ${brand}`, W / 2, H - 55); });
    const jpgs = [];
    for (const cv of pages) { const b = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9)); jpgs.push({ bytes: new Uint8Array(await b.arrayBuffer()), w: W, h: H }); }
    return pdfFromJpegs(jpgs);
  }

  // اسم الملف: طلبية + اسم الصيدلية + عنوانها
  function pdfName(d) {
    const c = d.cust || {}, clean = t => String(t || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    let n = ['طلبية', clean(c.name), clean(c.address)].filter(Boolean).join(' - ');
    if (n.length > 100) n = n.slice(0, 100).trim();
    return (n === 'طلبية' ? 'طلبية ' + d.no : n) + '.pdf';
  }

  // كاتب PDF مصغّر (صورة JPEG لكل صفحة A4) — بدون أي مكتبة خارجية
  function pdfFromJpegs(jpgs) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = b => { if (typeof b === 'string') b = enc.encode(b); parts.push(b); len += b.length; };
    const obj = (n, fn) => { offs[n] = len; push(`${n} 0 obj\n`); fn(); push('\nendobj\n'); };
    push('%PDF-1.4\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${jpgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${jpgs.length} >>`));
    jpgs.forEach((j, i) => {
      const p = 3 + i * 3, cs = `q 595.28 0 0 841.89 0 0 cm /Im${i} Do Q`;
      obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
      obj(p + 1, () => push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`));
      obj(p + 2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`); push(j.bytes); push('\nendstream'); });
    });
    const total = 3 + jpgs.length * 3, xref = len;
    push(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let k = 1; k < total; k++) push(String(offs[k]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  const dl = (blob, name) => { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 4000); };
  async function sendToWarehouse(d, btn, onlyDownload) {
    const old = btn && btn.textContent; if (btn) { btn.disabled = true; btn.textContent = 'جارٍ إنشاء الملف…'; }
    try {
      const cur = O.docs[d.id];   // حفظ ملاحظات المذخر مع الطلب (لا يعطّل الإرسال إن فشل)
      if (cur && (cur.whNote || '') !== (d.whNote || '')) OAPI.updateOrder(d.id, { whNote: d.whNote || '' }).then(() => { O.docs[d.id] = { ...cur, whNote: d.whNote || '' }; save(); }).catch(() => {});
      const blob = await makeOrderPdf(d), name = pdfName(d), wh = (d.warehouse && d.warehouse.name) || '';
      const file = new File([blob], name, { type: 'application/pdf' }), text = `طلب تجهيز #${d.no} — ${(d.cust || {}).name || ''}${wh ? ' — مذخر ' + wh : ''} — ${d.items.length} صنف`;
      if (!onlyDownload && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text, title: 'طلب تجهيز' }); markSent(d.id); drawOrders(); toast('تمت المشاركة ✅'); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      dl(blob, name);
      if (onlyDownload) return toast('تم تنزيل الملف');
      const link = (ls.get(WG, {}))[(d.warehouse || {}).id];
      if (link) { window.open(link, '_blank'); toast('نُزّل الملف. أرفقه في مجموعة المذخر'); } else toast('نُزّل الملف — أرسله إلى مجموعة المذخر من واتساب');
    } catch (e) { toast('تعذر إنشاء الملف: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
  }
  function groupsBox() {
    const L = typeof lists === 'function' ? lists() : (D.cfg.priceLists || []), cur = ls.get(WG, {});
    return el('div', { className: 'box' },
      el('p', { style: 'font-size:13.5px;color:var(--muted);margin-bottom:10px', textContent: 'اختياري: رابط دعوة مجموعة واتساب لكل مذخر (chat.whatsapp.com/…). يُحفظ على هذا الجهاز فقط ولا يُنشر مع التطبيق، حتى لا ينضم إليه غيرك. على الهاتف تختار المجموعة من قائمة المشاركة، والرابط يفيد على الحاسوب.' }),
      ...L.map(l => el('div', { className: 'fld' }, el('label', { textContent: 'مجموعة مبيعات ' + l.name }),
        el('input', { className: 'ltr', placeholder: 'https://chat.whatsapp.com/…', value: cur[l.id] || '', oninput: e => { const g = ls.get(WG, {}); const v = e.target.value.trim(); if (v) g[l.id] = v; else delete g[l.id]; ls.set(WG, g); } }))));
  }

  // ================= الإعدادات: ربط Firebase =================
  function settingsBox() {
    const c = D.cfg.orders || {}, set = (k, v) => { (D.cfg.orders = D.cfg.orders || {})[k] = v; touch(); }, f = (id, l, v, cb, type, ph) => el('div', { className: 'fld' }, el('label', { htmlFor: id, textContent: l }), el('input', { id, className: 'ltr', type: type || 'text', autocomplete: 'off', placeholder: ph || '', value: v || '', oninput: cb }));
    const st = el('p', { style: 'font-size:13px;margin:4px 0 10px' });
    const em = f('fb_em', 'بريد حساب المندوب في Firebase', fbCred ? fbCred.email : '', null, 'email', 'rep@example.com'), pw = f('fb_pw', 'كلمة مرور هذا الحساب', '', null, 'password');
    const paint = () => { st.textContent = fbCred ? '✅ بيانات الدخول محفوظة (مشفّرة على هذا الجهاز فقط)' : '⚠️ بيانات الدخول غير محفوظة على هذا الجهاز'; st.style.color = fbCred ? 'var(--brand-d)' : '#b45309'; };
    paint();
    return el('div', { className: 'box' },
      el('p', { style: 'font-size:13.5px;color:var(--muted);margin-bottom:10px', textContent: 'يفعّل حفظ الطلبات ومتابعة حالتها وظهورها للصيدلاني. أنشئ مشروع Firebase مجاناً حسب الدليل ثم أدخل بياناته هنا.' }),
      f('fb_pid', 'معرّف المشروع (Project ID)', c.projectId, e => set('projectId', e.target.value.trim()), 'text', 'my-catalog-12345'),
      f('fb_key', 'مفتاح الويب (Web API Key)', c.apiKey, e => set('apiKey', e.target.value.trim()), 'text', 'AIza…'),
      el('p', { style: 'font-size:12.5px;color:var(--muted);margin:-4px 0 12px', textContent: 'هذان يُنشران مع التطبيق (آمنان للنشر العام). بعد إدخالهما اضغط «مراجعة ونشر» لتُفعَّل الطلبات عند الصيادلة.' }),
      em, pw, el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px;margin:-4px 0 10px' },
        el('input', { type: 'checkbox', style: 'width:18px;height:18px', onchange: e => { $('#fb_pw').type = e.target.checked ? 'text' : 'password'; } }), 'إظهار كلمة المرور للتأكد منها'), st,
      el('div', { className: 'row', style: 'flex-wrap:wrap;gap:8px' },
        el('button', { type: 'button', className: 'btn sm', textContent: 'حفظ بيانات الدخول', onclick: () => {
          const email = $('#fb_em').value.trim(), password = $('#fb_pw').value; if (!email || !password) return toast('أدخل البريد وكلمة المرور');
          const inp = el('input', { type: 'password', autocomplete: 'off', placeholder: 'كلمة مرور اللوحة' });
          modal('تأكيد كلمة مرور اللوحة', [el('p', { style: 'margin-bottom:8px', textContent: 'تُحفظ بيانات Firebase مشفّرة بكلمة مرور اللوحة.' }), el('div', { className: 'fld' }, inp)], cl => [
            el('button', { type: 'button', className: 'btn ghost', textContent: 'إلغاء', onclick: cl }),
            el('button', { type: 'button', className: 'btn', textContent: 'حفظ', onclick: async () => {
              const s = ls.get('adm_box'); try { await unseal(inp.value, s.box); } catch { return toast('كلمة مرور اللوحة غير صحيحة'); }
              fbCred = { email, password }; s.box = await seal(inp.value, { token, fb: fbCred }); ls.set('adm_box', s); OAPI._tok = null; $('#fb_pw').value = ''; paint(); cl(); toast('تم الحفظ ✅'); } })]);
        } }),
        el('button', { type: 'button', className: 'btn ghost sm', textContent: 'اختبار الاتصال', onclick: async function () {
          this.disabled = true; this.textContent = 'جارٍ الاختبار…';
          try { OAPI.init(D.cfg.orders || {});
            const te = $('#fb_em').value.trim().toLowerCase(), tp = $('#fb_pw').value, typed = te && tp, cr = typed ? { email: te, password: tp } : fbCred;
            if (!cr) throw new Error('اكتب البريد وكلمة المرور ثم اختبر');
            try { await OAPI.login(cr.email, cr.password); } catch (e) { if (/غير صحيح/.test(e.message)) e.message += ` (جرّبتُ: ${cr.email} — طول كلمة المرور ${cr.password.length} — ${typed ? 'من الحقلين' : 'من المحفوظ'})`; throw e; } await OAPI.ordersSince(Date.now() - 1000); toast('الاتصال ناجح ✅'); }
          catch (e) { toast(e.message); } finally { this.disabled = false; this.textContent = 'اختبار الاتصال'; } } }),
        fbCred ? el('button', { type: 'button', className: 'btn ghost sm', textContent: 'نسيان بيانات الدخول', onclick: async () => { const p = prompt('كلمة مرور اللوحة للتأكيد'); if (p == null) return; const s = ls.get('adm_box');
          try { await unseal(p, s.box); } catch { return toast('كلمة مرور اللوحة غير صحيحة'); } fbCred = null; s.box = await seal(p, { token }); ls.set('adm_box', s); OAPI._tok = null; paint(); toast('تم الحذف'); } }) : null));
  }

  return { tabOrders, tabReturns, tabStatement, settingsBox, groupsBox, makeOrderPdf, stop };
})();
