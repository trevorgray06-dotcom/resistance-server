const CACHE_NAME = 'resistance-online-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/online.js', '/manifest.webmanifest', '/assets/icon-192.png', '/assets/icon-512.png'];
self.addEventListener('install', e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))); self.skipWaiting();});
self.addEventListener('activate', e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME&&caches.delete(k))))); self.clients.claim();});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/socket.io/')) return; // don't cache socket
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(n=>{
    if (e.request.method==='GET' && n.ok) caches.open(CACHE_NAME).then(c=>c.put(e.request, n.clone()));
    return n;
  })));
});