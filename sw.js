// ═══════════════════════════════════════════════════════════════
// StarBeer — Service Worker PWA
// Gestion du cache pour fonctionnement hors ligne
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'starbeer-v1.0';

// ── Phase d'installation : pré-cache du shell de l'app ──
self.addEventListener('install', (event) => {
    console.log('[SW] Installation en cours…');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pré-cache des fichiers shell…');
            return cache.addAll([
                './',
                './index.html',
                './styles.css'
            ]);
        }).then(() => {
            console.log('[SW] Cache initialisé — skip waiting');
            return self.skipWaiting();
        })
    );
});

// ── Phase d'activation : nettoyage des anciens caches ──
self.addEventListener('activate', (event) => {
    console.log('[SW] Activation en cours…');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Suppression ancien cache :', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] SW activé — prise en compte immédiate');
            return self.clients.claim();
        })
    );
});

// ── Stratégie de fetch : intercept

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // ── Google Fonts : stale-while-revalidate ──
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    // ── Requêtes de navigation : network first, fallback index.html ──
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }

    // ── Assets statiques same-origin : cache first ──
    if (url.origin === location.origin) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // ── Autres requêtes : try network, fallback cache ──
    event.respondWith(networkWithCacheFallback(request));
});

// ── Stratégies de cache ──

/** Cache first — pour les assets locaux */
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Hors ligne — ressource non disponible', { status: 503 });
    }
}

/** Network first — pour la navigation */
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match('./index.html');
        if (cached) return cached;
        return new Response('Hors ligne — aucune page disponible', { status: 503 });
    }
}

/** Stale-while-revalidate — pour les Google Fonts */
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const networkFetch = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    });
    return cached || networkFetch;
}

/** Network with fallback — pour les ressources tierces */
async function networkWithCacheFallback(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Ressource non disponible hors ligne', { status: 503 });
    }
}

// ── Écoute du message pour forcer la mise à jour ──
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});