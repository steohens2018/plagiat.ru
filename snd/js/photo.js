// Фото: чтение (в том числе HEIC с iPhone), поворот по EXIF, сжатие, закраска и распознавание.
// Картинка всегда перерисовывается через canvas — так из неё пропадают EXIF, геолокация
// и прочие метаданные. Закраска — сплошная заливка: пиксели заменяются, а не размываются.
'use strict';

const Photo = {
  // Файл → ImageBitmap с учётом ориентации. HEIC, который браузер не читает сам, конвертируется на устройстве.
  async decode(file){
    const tryBitmap = async blob => {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch(e){ /* ниже — через <img> */ }
      return new Promise((res, rej) => {
        const img = new Image(), url = URL.createObjectURL(blob);
        img.onload = () => { URL.revokeObjectURL(url); res(img); };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('формат не поддерживается')); };
        img.src = url;
      });
    };
    try { return await tryBitmap(file); }
    catch(e){
      const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
      if(!heic) throw new Error('Не удалось открыть фото: ' + e.message + '. Сохраните его как JPEG или сделайте снимок экрана.');
      try {
        return await tryBitmap(await this.heicToJpeg(file));
      } catch(e2){
        throw new Error('Фото в формате HEIC не удалось преобразовать. На iPhone: Настройки → Камера → Форматы → «Наиболее совместимый», либо отправьте снимок экрана.');
      }
    }
  },
  // HEIC → JPEG в изолированной рамке (vendor/heic.html): библиотеке нужен eval, приложению он запрещён.
  // Рамка без доступа к данным приложения и без сети; общение — только сообщениями.
  heicToJpeg(file){
    return new Promise((res, rej) => {
      const fr = document.createElement('iframe'), id = uid();
      fr.hidden = true; fr.src = 'vendor/heic.html';
      // В сети рамка полностью изолирована. Без сети изолированную рамку service worker не обслуживает,
      // поэтому она открывается как обычная страница приложения — со своим запретом на любые сетевые запросы.
      if(navigator.onLine) fr.setAttribute('sandbox', 'allow-scripts');
      const done = (fn, v) => { clearTimeout(timer); window.removeEventListener('message', onMsg); fr.remove(); fn(v); };
      const onMsg = e => {
        if(e.source !== fr.contentWindow || !e.data) return;
        if(e.data.ready) fr.contentWindow.postMessage({ id, blob: file }, '*');
        else if(e.data.id === id) e.data.blob instanceof Blob ? done(res, e.data.blob) : done(rej, new Error(e.data.error || 'ошибка преобразования'));
      };
      const timer = setTimeout(() => done(rej, new Error('преобразование не завершилось')), 60000);
      window.addEventListener('message', onMsg);
      document.body.appendChild(fr);
    });
  },
  // Холст не больше maxSide по длинной стороне; turn — поворот на 90° по часовой стрелке (0–3)
  canvas(src, maxSide = 2200, turn = 0){
    const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const cv = document.createElement('canvas'), odd = turn % 2 === 1;
    cv.width = odd ? h : w; cv.height = odd ? w : h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(turn * Math.PI / 2);
    ctx.drawImage(src, -w / 2, -h / 2, w, h);
    return cv;
  },
  blob(cv, quality = 0.85){ return new Promise(res => cv.toBlob(res, 'image/jpeg', quality)); },
  // JPEG не тяжелее maxBytes: сначала снижаем качество, потом размер
  async jpeg(cv, maxBytes = 3e6, maxSide = 2000){
    let cur = Math.max(cv.width, cv.height) > maxSide ? this.canvas(cv, maxSide) : cv;
    for(let step = 0; step < 8; step++){
      for(const q of [0.85, 0.7, 0.55]){
        const b = await this.blob(cur, q);
        if(b.size <= maxBytes) return b;
      }
      cur = this.canvas(cur, Math.round(Math.max(cur.width, cur.height) * 0.75));
    }
    return this.blob(cur, 0.5);
  },
  async dataUrl(blob){
    const u8 = new Uint8Array(await blob.arrayBuffer());
    return 'data:image/jpeg;base64,' + b64.enc(u8);
  },

  // Редактор закраски. Возвращает холст с закрашенными областями или null, если отменено.
  // headerPct — высота автоматически закрашиваемой анкетной шапки бланка (в процентах), её можно менять.
  redact(source, headerPct = 28){
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'redactor';
      el.innerHTML = `
        <div class="red-top">
          <b>Закрасьте персональные данные</b>
          <span class="muted">Шапка бланка закрашена автоматически. Проведите пальцем по фамилиям, адресам и телефонам в тексте.</span>
        </div>
        <div class="red-scroll"><canvas></canvas></div>
        <div class="red-bar">
          <label class="red-range">Шапка: <output>${headerPct}</output>%
            <input type="range" min="0" max="70" value="${headerPct}" aria-label="Высота закрашенной шапки"></label>
          <div class="row">
            <button type="button" class="btn sm" data-a="mode">Листать</button>
            <button type="button" class="btn sm" data-a="undo">Отменить штрих</button>
            <button type="button" class="btn sm" data-a="cancel">Отмена</button>
            <button type="button" class="btn sm gold" data-a="ok">Готово</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      const cv = $('canvas', el), ctx = cv.getContext('2d');
      cv.width = source.width; cv.height = source.height;
      const strokes = []; let pct = headerPct, cur = null, paint = true;
      const brush = Math.max(18, Math.round(source.width * 0.035));
      const draw = () => {
        ctx.drawImage(source, 0, 0);
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brush;
        ctx.fillRect(0, 0, cv.width, Math.round(cv.height * pct / 100));
        for(const s of strokes){
          ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y);
          if(s.length === 1) ctx.lineTo(s[0].x + 0.1, s[0].y);
          for(const p of s.slice(1)) ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
      };
      const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
      cv.addEventListener('pointerdown', e => { if(!paint) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); cur = [pos(e)]; strokes.push(cur); draw(); });
      cv.addEventListener('pointermove', e => { if(!cur) return; cur.push(pos(e)); draw(); });
      const end = () => { cur = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      $('input', el).addEventListener('input', e => { pct = +e.target.value; $('output', el).textContent = pct; draw(); });
      const close = result => { el.remove(); resolve(result); };
      el.addEventListener('click', e => {
        const a = e.target.closest('[data-a]'); if(!a) return;
        if(a.dataset.a === 'undo'){ strokes.pop(); draw(); }
        if(a.dataset.a === 'mode'){ paint = !paint; cv.classList.toggle('pan', !paint); a.textContent = paint ? 'Листать' : 'Закрашивать'; }
        if(a.dataset.a === 'cancel') close(null);
        if(a.dataset.a === 'ok'){
          // Итог рисуем на новом холсте: в нём нет ни исходных пикселей под заливкой, ни метаданных
          const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
          draw(); out.getContext('2d').drawImage(cv, 0, 0);
          close(out);
        }
      });
      Photo._closeRedactor = () => close(null);
      draw();
    });
  }
};

// Распознавание печатного текста на устройстве (Tesseract.js, русская модель лежит рядом с приложением)
const Ocr = {
  worker: null, progress: null,
  async read(cv, onProgress){
    if(!window.Tesseract) await loadScript('vendor/ocr/tesseract.min.js');
    if(!this.worker){
      const base = new URL('vendor/ocr/', location.href).href;
      this.worker = await Tesseract.createWorker('rus', 1, {
        workerPath: base + 'worker.min.js', corePath: base, langPath: base,
        logger: m => { if(m.status === 'recognizing text' && this.progress) this.progress(m.progress); }
      });
    }
    // Серый и контрастный вариант читается лучше
    const g = document.createElement('canvas'); g.width = cv.width; g.height = cv.height;
    const ctx = g.getContext('2d'); ctx.filter = 'grayscale(1) contrast(1.15)'; ctx.drawImage(cv, 0, 0);
    this.progress = onProgress;
    const { data } = await this.worker.recognize(g);
    this.progress = null;
    // Склеиваем строки внутри абзацев, переносы слов убираем
    return data.text.replace(/-\n(?=\p{Ll})/gu, '').replace(/([^\n])\n(?!\n)/g, '$1 ').replace(/[ \t]+/g, ' ').trim();
  }
};

// --- Адрес и почтовый индекс ---------------------------------------------------------
// «г. Абакан, ул. Пушкина, д. 120, кв. 45» → части адреса
function parseAddress(s){
  let t = String(s || '').replace(/\s+/g, ' ').trim(), city = '';
  const cm = /^(?:Республика\s+[А-ЯЁ][а-яё]+,?\s*)?((?:г\.|гор\.|город|с\.|село|п\.|пос\.|пгт\.?|аал|рп\.?)\s*[А-ЯЁ][а-яё-]+(?:\s[А-ЯЁ][а-яё-]+)?)\s*,?\s*/u.exec(t);
  if(cm){ city = cm[1].replace(/^(?:гор\.|город)\s*/, 'г. '); t = t.slice(cm[0].length); }
  else if(/^Абакан\s*,?\s*/.test(t)){ city = 'г. Абакан'; t = t.replace(/^Абакан\s*,?\s*/, ''); }
  let flat = '', house = '';
  t = t.replace(/,?\s*(?:кв\.|квартира)\s*(\d+)\s*$/iu, (m, n) => { flat = n; return ''; });
  let hm = /,?\s*(?:д\.|дом)\s*(\d+\s?[А-Яа-я]?(?:\/\d+)?)(?:\s*-\s*(\d+))?\s*$/iu.exec(t) || /,?\s+(\d+\s?[А-Яа-я]?(?:\/\d+)?)(?:\s*-\s*(\d+))?\s*$/u.exec(t);
  if(hm){ house = hm[1].replace(/\s/g, '').toLowerCase(); if(hm[2] && !flat) flat = hm[2]; t = t.slice(0, hm.index); }
  let street = t.replace(/[,\s]+$/, '').trim();
  if(street && !/^(?:ул\.|улица|пр\.|пр-т|просп|проспект|пер\.|переулок|мкр|микрорайон|ш\.|шоссе|б-р|бульвар|наб\.|пл\.|площадь|снт|проезд|кв-л|квартал)/i.test(street)) street = 'ул. ' + street;
  return { city, street, house, flat };
}

// Таблица «улица, дом → индекс». Начальная таблица — data/abakan-index.json, исправления
// пользователя хранятся в зашифрованной базе и имеют приоритет.
const ZipIdx = {
  base: null, fix: null,
  norm(street){
    return String(street || '').toLowerCase().replace(/ё/g, 'е')
      .replace(/^(?:ул\.|улица|пр\.|пр-т|просп\.|проспект|пер\.|переулок|мкр\.?|микрорайон|ш\.|шоссе|б-р|бульвар|наб\.|пл\.|площадь|снт|проезд|кв-л|квартал)\s*/, '').replace(/[^а-я0-9 -]/g, '').replace(/\s+/g, ' ').trim();
  },
  async init(){
    if(!this.base){
      try { this.base = await (await fetch('data/abakan-index.json')).json(); } catch(e){ this.base = { streets: {} }; }
    }
    this.fix = (await Store.getKV('zipfix')) || {};
  },
  lookup(street, house){
    const st = this.norm(street), h = String(house || '').toLowerCase().replace(/\s/g, '');
    if(!st) return null;
    const f = this.fix && (this.fix[st + '|' + h] || (!h && this.fix[st + '|']));
    if(f) return { zip: f, src: 'fix' };
    const row = this.base && this.base.streets && this.base.streets[st];
    if(!row) return null;
    if(row.h && row.h[h]) return { zip: row.h[h], src: 'table' };
    const n = parseInt(h, 10);
    for(const r of row.r || []){            // диапазоны: [с, по, чётность (0 — любые, 1 — нечётные, 2 — чётные), индекс]
      if(n >= r[0] && n <= r[1] && (!r[2] || (r[2] === 1) === (n % 2 === 1))) return { zip: r[3], src: 'table' };
    }
    return row.all ? { zip: row.all, src: 'street' } : null;
  },
  async remember(street, house, zip){
    const st = this.norm(street), h = String(house || '').toLowerCase().replace(/\s/g, '');
    if(!st || !/^\d{6}$/.test(zip)) return;
    this.fix[st + '|' + h] = zip;
    await Store.setKV('zipfix', this.fix);
  }
};
