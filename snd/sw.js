// Service Worker: приложение целиком открывается без сети. Все библиотеки лежат рядом, CDN нет.
// При изменении набора файлов поднимать CACHE.
const CACHE = 'snd-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/util.js', 'js/decl.js', 'js/data.js', 'js/store.js', 'js/mask.js', 'js/photo.js', 'js/ai.js', 'js/docx.js', 'js/selfdata.js', 'js/selftest.js', 'js/app.js',
  'vendor/pizzip.min.js', 'vendor/docxtemplater.min.js', 'vendor/heic2any.min.js', 'vendor/heic.html', 'vendor/heic-frame.js',
  'vendor/ocr/tesseract.min.js', 'vendor/ocr/worker.min.js', 'vendor/ocr/tesseract-core-simd-lstm.wasm.js', 'vendor/ocr/tesseract-core-lstm.wasm.js', 'vendor/ocr/rus.traineddata.gz',
  'templates/uvedomlenie.docx', 'templates/raport_snd.docx', 'templates/raport_proverka.docx', 'templates/raport_priobshenie.docx',
  'templates/telefonogramma.docx', 'templates/mfo_raport.docx', 'templates/mfo_uvedomlenie.docx',
  'data/abakan-index.json', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/maskable-512.png'
];
self.addEventListener('install', e => {
  // Файлы кладём по одному: сбой одного большого файла не срывает установку остальных
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('snd-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if(e.request.method !== 'GET' || url.origin !== location.origin) return;      // запросы к нейросети не трогаем и не кешируем
  const heavy = /\/(vendor|templates|icons)\//.test(url.pathname);
  if(heavy){
    // Библиотеки и шаблоны меняются редко: сначала кеш
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })));
  } else {
    // Страница и код: сначала сеть (чтобы приходили обновления), без сети — из кеша
    e.respondWith(fetch(e.request).then(r => { if(r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
  }
});
