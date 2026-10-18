// Service worker: מאפשר לאפליקציה להיפתח גם בלי קליטה.
// קבצי האפליקציה: רשת קודם, ואם אין רשת מהמטמון (כך שעדכון גרסה מגיע מיד כשיש קליטה).
// נתוני Firestore ו-Auth לא עוברים כאן, הם מנוהלים על ידי ה-SDK עם מטמון משלו.
const VERSION = 'v13';
const CACHE = 'teamhub-' + VERSION;
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/settle.js', 'js/config.js', 'js/backend-firebase.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('teamhub-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const font = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';
  if (!sameOrigin && !font) return;                       // Firebase וה-SDK מטפלים בעצמם
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
