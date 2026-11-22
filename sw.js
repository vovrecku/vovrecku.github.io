/* =========================================================
   SERVICE WORKER – pomocník, ktorý beží v pozadí prehliadača.
   Vďaka nemu:
   - sa aplikácia dá nainštalovať na plochu ako appka,
   - funguje aj bez internetu (aj s grafmi).
   Tvoje dáta NEUKLADÁ ani NEPOSIELA – tie sú len v prehliadači (localStorage).
   Pracuje iba so súbormi tejto aplikácie, s nikým iným nekomunikuje.
   ========================================================= */

// Pri zmene súborov stačí zvýšiť číslo verzie
const CACHE = 'vovrecku-v1';

const FILES = [
  './', './app.js', './manifest.webmanifest', './vendor/chart.umd.min.js',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png',
  './vendor/fonts/fonts.css', './vendor/fonts/Archivo-normal-latin-ext.woff2','./vendor/fonts/Archivo-normal-latin.woff2','./vendor/fonts/InstrumentSerif-italic-latin-ext.woff2','./vendor/fonts/InstrumentSerif-italic-latin.woff2','./vendor/fonts/JetBrainsMono-normal-latin-ext.woff2','./vendor/fonts/JetBrainsMono-normal-latin.woff2'
];

// Pri inštalácii si stiahne všetky súbory aplikácie do zásoby
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

// Zmaže staré zásoby po aktualizácii
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Súbory aplikácie: najprv z internetu (aby si mal vždy novú verziu), bez internetu zo zásoby.
// Požiadavky na iné stránky si nevšíma.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./')))
  );
});
