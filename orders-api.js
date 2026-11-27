'use strict';
/* =====================================================================
   طبقة بيانات الطلبات — Firestore عبر REST (بدون أي مكتبة خارجية)
   تُستخدم في تطبيق الصيدلاني (إنشاء وقراءة طلباته) وفي لوحة المندوب (إدارة كاملة)
   ===================================================================== */
(function () {
  const enc = v => {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    return { mapValue: { fields: encF(v) } };
  };
  const encF = o => { const f = {}; for (const k in o) if (o[k] !== undefined) f[k] = enc(o[k]); return f; };
  const dec = v => {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return decF(v.mapValue.fields || {});
    if ('timestampValue' in v) return v.timestampValue;
    return null;
  };
  const decF = f => { const o = {}; for (const k in f) o[k] = dec(f[k]); return o; };
  const docOf = d => { const o = decF(d.fields || {}); for (const k of ['createdAt', 'updatedAt']) if (typeof o[k] === 'string') o[k] = Date.parse(o[k]); return o; };
  const T = ms => ({ timestampValue: new Date(ms).toISOString() });

  const AUTH_MSG = {
    EMAIL_NOT_FOUND: 'البريد غير مسجّل في Firebase', INVALID_PASSWORD: 'كلمة مرور Firebase غير صحيحة',
    INVALID_LOGIN_CREDENTIALS: 'بريد أو كلمة مرور Firebase غير صحيحين', USER_DISABLED: 'الحساب معطّل',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'محاولات كثيرة — انتظر قليلاً', INVALID_EMAIL: 'صيغة البريد غير صحيحة',
    API_KEY_INVALID: 'مفتاح API غير صحيح', OPERATION_NOT_ALLOWED: 'فعّل تسجيل الدخول بالبريد وكلمة المرور في Firebase'
  };

  const OAPI = {
    cfg: null, _tok: null, _ref: null, _exp: 0,
    init(c) { this.cfg = c && c.projectId && c.apiKey ? { projectId: String(c.projectId).trim(), apiKey: String(c.apiKey).trim() } : null; this._tok = null; return !!this.cfg; },
    get on() { return !!this.cfg; },
    get loggedIn() { return !!this._tok; },
    _root() { return `projects/${this.cfg.projectId}/databases/(default)/documents`; },
    async _req(path, { method = 'GET', body, auth, keepalive } = {}) {
      if (!this.cfg) throw Object.assign(new Error('الطلبات غير مفعّلة'), { off: true });
      const url = `https://firestore.googleapis.com/v1/${this._root()}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(this.cfg.apiKey)}`;
      const headers = { 'Content-Type': 'application/json' };
      if (auth) headers.Authorization = 'Bearer ' + await this.token();
      let r;
      try { r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive: !!keepalive, cache: 'no-store' }); }
      catch { throw Object.assign(new Error('تعذر الاتصال بالإنترنت'), { net: true }); }
      if (!r.ok) {
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch {}
        const t = { 401: 'انتهت جلسة الدخول', 403: 'ليس لديك صلاحية (راجع قواعد Firestore وبريد المندوب)', 404: 'قاعدة البيانات غير موجودة — راجع اسم المشروع وأنشئ Firestore', 409: 'موجود مسبقاً' }[r.status] || ('خطأ ' + r.status);
        throw Object.assign(new Error(t + (m && r.status >= 400 && ![401, 403, 404, 409].includes(r.status) ? ' — ' + m : '')), { status: r.status });
      }
      return r.status === 204 ? null : r.json();
    },

    // ----- جهة الصيدلاني -----
    // الوقت يُسجَّل من خادم Google (وليس من ساعة هاتف الصيدلاني) حتى لا يضيع أي طلب بسبب ساعة خاطئة
    async createOrder(o, keepalive) {
      const w = { update: { name: `${this._root()}/orders/${o.id}`, fields: encF(o) }, currentDocument: { exists: false },
        updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] };
      try { await this._req(':commit', { method: 'POST', body: { writes: [w] }, keepalive }); return true; }
      catch (e) { if (e.status === 409 || /ALREADY_EXISTS/.test(e.message)) return true; throw e; }
    },
    async getOrders(ids) {
      if (!ids.length) return {};
      const r = await this._req(':batchGet', { method: 'POST', body: { documents: ids.map(i => `${this._root()}/orders/${i}`) } });
      const out = {};
      for (const x of r || []) if (x.found) { const d = docOf(x.found); out[d.id || x.found.name.split('/').pop()] = d; }
      return out;
    },

    // ----- جهة المندوب -----
    async login(email, password) {
      let r;
      try { r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.cfg.apiKey)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }); }
      catch { throw Object.assign(new Error('تعذر الاتصال بالإنترنت'), { net: true }); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const code = String(j.error?.message || '').split(' ')[0]; throw new Error(AUTH_MSG[code] || ('تعذر الدخول إلى Firebase: ' + (code || r.status))); }
      this._tok = j.idToken; this._ref = j.refreshToken; this._exp = Date.now() + (Number(j.expiresIn) || 3600) * 1000;
    },
    async token() {
      if (!this._tok) throw Object.assign(new Error('سجّل دخول Firebase أولاً'), { needLogin: true });
      if (Date.now() > this._exp - 60000) {
        const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.cfg.apiKey)}`,
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this._ref)}` });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { this._tok = null; throw Object.assign(new Error('انتهت جلسة Firebase'), { needLogin: true }); }
        this._tok = j.id_token; this._ref = j.refresh_token || this._ref; this._exp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
      }
      return this._tok;
    },
    async _query(sq) {
      const r = await this._req(':runQuery', { method: 'POST', auth: true, body: { structuredQuery: sq } });
      return (r || []).filter(x => x.document).map(x => docOf(x.document));
    },
    // الطلبات التي تغيّرت بعد وقت معيّن (تحديث تدريجي يقلل القراءات)
    async ordersSince(ms) {
      const all = []; let since = ms;
      for (let i = 0; i < 20; i++) {
        const page = await this._query({ from: [{ collectionId: 'orders' }],
          where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: T(since) } },
          orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }], limit: 300 });
        all.push(...page);
        if (page.length < 300) break;
        since = page[page.length - 1].updatedAt;
      }
      return all;
    },
    updateOrder(id, patch) {
      const w = { update: { name: `${this._root()}/orders/${id}`, fields: encF(patch) }, updateMask: { fieldPaths: Object.keys(patch) },
        currentDocument: { exists: true }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] };
      return this._req(':commit', { method: 'POST', auth: true, body: { writes: [w] } });
    },
    deleteOrder(id) { return this._req(`/orders/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }); },
    listReturns() {
      return this._query({ from: [{ collectionId: 'returns' }], orderBy: [{ field: { fieldPath: 'createdMs' }, direction: 'DESCENDING' }], limit: 500 });
    },
    saveReturn(r) { return this._req(`/returns/${encodeURIComponent(r.id)}`, { method: 'PATCH', auth: true, body: { fields: encF(r) } }); },
    listQuotas() { return this._query({ from: [{ collectionId: 'bonusQuotas' }], limit: 300 }); },
    saveQuota(q) { return this._req(`/bonusQuotas/${encodeURIComponent(q.id)}`, { method: 'PATCH', auth: true, body: { fields: encF(q) } }); },
    deleteQuota(id) { return this._req(`/bonusQuotas/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }); },
    deleteReturn(id) { return this._req(`/returns/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true }); }
  };

  // أسماء الحالات (مشتركة بين التطبيقين)
  OAPI.STATUS = {
    new: { t: 'تم الاستلام', c: '#2563eb', ic: '📥' },
    preparing: { t: 'قيد التجهيز', c: '#d97706', ic: '🛠️' },
    ready: { t: 'جاهز للتسليم', c: '#0f9d7a', ic: '✅' },
    delivered: { t: 'تم التسليم', c: '#475569', ic: '🚚' },
    hold: { t: 'معلّق', c: '#dc2626', ic: '⏸️' },
    cancelled: { t: 'ملغى', c: '#6b7280', ic: '✖️' }
  };
  OAPI.newId = () => { const a = new Uint8Array(20), cs = 'abcdefghijklmnopqrstuvwxyz0123456789'; crypto.getRandomValues(a); return [...a].map(x => cs[x % cs.length]).join(''); };
  window.OAPI = OAPI;
})();
