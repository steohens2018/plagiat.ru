// Мелкие общие функции: экранирование, уведомления, даты, скачивание.
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Всё, что попадает в innerHTML из документа, ответа ИИ или от пользователя, идёт через escapeHtml
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toast(text, kind = ''){
  const box = $('#toasts'); if(!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}

const pad2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
// 2026-11-15 → 15.11.2026
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || ''); };
// 15.11.2026 или 15.11.26 → 2026-11-15
function toIso(s){
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})/.exec(s || '');
  if(!m) return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '';
  const y = m[3].length === 2 ? (+m[3] > 40 ? '19' : '20') + m[3] : m[3];
  return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function loadScript(src){
  return new Promise((res, rej) => {
    if($(`script[data-src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = res; s.onerror = () => rej(new Error('не загрузился файл ' + src));
    document.head.appendChild(s);
  });
}

function downloadBlob(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

const b64 = {
  enc(u8){ let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  dec(str){ return Uint8Array.from(atob(str), c => c.charCodeAt(0)); }
};

// Предложение с точкой в конце; «…о том, что» + текст со строчной буквы (кроме имён и аббревиатур)
const sentence = t => { t = (t || '').trim(); return !t ? '' : /[.!?…]$/.test(t) ? t : t + '.'; };
const lcFirst = t => t ? t[0].toLowerCase() + t.slice(1) : t;
const cont = t => { t = (t || '').trim(); return !t ? '' : /^[А-ЯЁA-Z]{2}|^[А-ЯЁ]\.\s?[А-ЯЁ]\.|^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ]/.test(t) ? t : lcFirst(t); };
