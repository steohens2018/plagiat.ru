// Работает внутри изолированной рамки: получает файл HEIC, возвращает JPEG. Больше ничего не умеет.
'use strict';
window.addEventListener('message', async e => {
  if(e.source !== window.parent || !e.data || !(e.data.blob instanceof Blob)) return;
  const id = e.data.id;
  try {
    const out = await window.heic2any({ blob: e.data.blob, toType: 'image/jpeg', quality: 0.92 });
    window.parent.postMessage({ id, blob: Array.isArray(out) ? out[0] : out }, '*');
  } catch(err){
    window.parent.postMessage({ id, error: String(err && (err.message || err.code) || err) }, '*');
  }
});
window.parent.postMessage({ ready: true }, '*');
