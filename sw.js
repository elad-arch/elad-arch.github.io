// sw.js - מאפשר לאפליקציה להיפתח גם בלי אינטרנט.
// קבצי האפליקציה: קודם מהרשת (כדי לקבל עדכונים), ואם אין רשת - מהעותק השמור.
// ספריות חיצוניות: מהעותק השמור, ומתעדכנות ברקע.
// קריאות ל-/api ופניות ל-BankBox (או לכל שרת אחר) לא עוברות כאן לעולם ולא נשמרות.

importScripts('/version.js'); // APP_VERSION - כל גרסה מקבלת עותק שמור חדש
const CACHE_NAME = `mazpen-${APP_VERSION}`;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const APP_SHELL = [
    '/',
    '/index.html',
    '/version.js',
    '/script.js',
    '/bankbox.js',
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

// מאפשר לדף לשאול איזו גרסה של הרכיב פעילה (לאבחון)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'version' && event.ports && event.ports[0]) {
        event.ports[0].postMessage({ version: APP_VERSION });
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
    // מחוץ לאתר: רק הספריות המוכרות. כל השאר (למשל BankBox) הולך ישר לרשת, בלי מטמון.
    if (url.origin !== self.location.origin && !CDN_HOSTS.includes(url.hostname)) return;

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
