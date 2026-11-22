// Service Worker — يجعل الكتالوج يعمل بدون إنترنت ويبقي الأسعار محدّثة
const V = 'dajla-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'orders-api.js', 'manifest.webmanifest', 'config.json', 'offers.json',
  'pricelists.json', 'products.json', 'icons/logo.png', 'icons/icon-192.png', 'fonts/cairo-arabic.woff2', 'fonts/cairo-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(SHELL);
    try {   // تخزين صور المنتجات المصغّرة مسبقاً ليعمل الكتالوج كاملاً بدون إنترنت
      const products = await (await fetch('products.json', { cache: 'no-cache' })).json();
      await Promise.all([...new Set(products.map(p => p.image))].map(i => c.add('thumbs/' + encodeURI(i)).catch(() => {})));
    } catch (_) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms));

async function networkFirst(req) {   // الملفات والبيانات: الأحدث من الشبكة، وإن فشلت فالمحفوظ
  const c = await caches.open(V);
  try {
    const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (_) {
    return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
  }
}
async function staleWhileRevalidate(req) {   // الصور والخطوط: المحفوظ فوراً وتحديث بالخلفية
  const c = await caches.open(V);
  const hit = await c.match(req);
  const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const p = url.pathname;
  if (/\/(images|thumbs|icons|fonts)\//.test(p)) e.respondWith(staleWhileRevalidate(req));
  else e.respondWith(networkFirst(req));
});
