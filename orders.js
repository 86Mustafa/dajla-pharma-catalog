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
  const stop = () => { clearInterval(timer); timer = null; ui = null; retUi = null; };
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
        d.items.some(i => i.prepared != null && i.prepared < i.qty) ? el('span', { className: 'ord-st', style: 'background:#b45309', textContent: 'جزئي' }) : null),
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
        const patch = { status, items, repNote: note.value.trim(), holdReason: status === 'hold' ? reason : '', history: [...(d.history || []), { s: status, at: Date.now(), note: reason }] };
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

  return { tabOrders, tabReturns, settingsBox, stop };
})();
