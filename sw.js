// sw.js - מאפשר לאפליקציה להיפתח גם בלי אינטרנט.
// קבצי האפליקציה: קודם מהרשת (כדי לקבל עדכונים), ואם אין רשת - מהעותק השמור.
// ספריות חיצוניות: מהעותק השמור, ומתעדכנות ברקע.
// קריאות ל-/api לא עוברות כאן לעולם.

const CACHE_NAME = 'mazpen-v1';
const APP_SHELL = [
    '/',
    '/index.html',
    '/script.js',
    '/styles.css',
    '/favicon.svg',
    '/manifest.webmanifest',
    '/icons/icon-180.png',
    '/icons/icon-192.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true })
                    .then(cached => cached || (request.mode === 'navigate' ? caches.match('/index.html') : undefined))
                    .then(cached => cached || Response.error()))
        );
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then(cache => cache.match(request).then(cached => {
            const network = fetch(request)
                .then(response => {
                    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
                    return response;
                })
                .catch(() => cached || Response.error());
            return cached || network;
        }))
    );
});
