// Интерфейс: вход по PIN-коду, список материалов, четыре шага (Фото → Поля → Пакет → Скачать), настройки.
'use strict';

const App = { c: null, step: 'photo', pack: null, urls: [], idle: null, masker: null };
const app = () => $('#app');
const E = escapeHtml;

// --- Модальные окна ---------------------------------------------------------------
// Возвращает значение data-r нажатой кнопки; при блокировке все окна закрываются.
const openModals = new Set();
function modal(html, onMount){
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
    const close = v => { openModals.delete(close); el.remove(); resolve(v); };
    openModals.add(close);
    el.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if(b) close(b.dataset.r); });
    document.body.appendChild(el);
    if(onMount) onMount(el, close);
  });
}
const confirmBox = (title, text, yes = 'Да', danger = false) => modal(
  `<h3>${E(title)}</h3><p class="muted">${E(text)}</p><div class="row"><button class="btn grow" data-r="">Отмена</button><button class="btn grow ${danger ? 'danger' : 'gold'}" data-r="yes">${E(yes)}</button></div>`);
// Запрос пароля (одно или два поля)
function askPassword(title, text, twice){
  return modal(`<h3>${E(title)}</h3><p class="muted">${E(text)}</p>
    <label class="f"><span>Пароль</span><input type="password" id="pw1" autocomplete="off"></label>
    ${twice ? '<label class="f"><span>Ещё раз</span><input type="password" id="pw2" autocomplete="off"></label>' : ''}
    <div class="row"><button class="btn grow" data-r="">Отмена</button><button class="btn grow gold" id="pwOk">Готово</button></div>`,
    (el, close) => {
      $('#pwOk', el).onclick = () => {
        const a = $('#pw1', el).value;
        if(a.length < 6) return toast('Пароль — от 6 символов', 'err');
        if(twice && a !== $('#pw2', el).value) return toast('Пароли не совпадают', 'err');
        close(a);
      };
    });
}

// --- Блокировка -------------------------------------------------------------------
function lockApp(){
  Store.lock();
  App.c = null; App.pack = null; App.masker = null;
  App.urls.forEach(u => URL.revokeObjectURL(u)); App.urls = [];
  [...openModals].forEach(close => close(''));
  if(Photo._closeRedactor) Photo._closeRedactor();
  $('#toasts').textContent = '';
  $('#title').textContent = 'СНД';            // в шапке не должно остаться номера КУСП и фамилии
  clearTimeout(App.idle); clearTimeout(saveTimer);
  render();
}
function touchIdle(){
  clearTimeout(App.idle);
  if(!Store.key) return;
  const min = +(Store.cfg && Store.cfg.lockMin) || 5;
  App.idle = setTimeout(lockApp, min * 60000);
}
['pointerdown', 'keydown', 'input'].forEach(ev => document.addEventListener(ev, touchIdle, { passive: true }));
// Свернули приложение надолго — блокируем при возврате
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if(document.hidden) hiddenAt = Date.now();
  else if(Store.key && hiddenAt && Date.now() - hiddenAt > (+(Store.cfg.lockMin) || 5) * 60000) lockApp();
});

// --- Маршруты ---------------------------------------------------------------------
function go(hash){ if(location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', render);

async function render(){
  const st = await Store.state();
  document.body.dataset.state = st;
  $('#top').hidden = st !== 'open';
  $('#net').hidden = navigator.onLine;
  if(st === 'new') return renderSetup();
  if(st === 'locked') return renderLock();
  touchIdle();
  const h = location.hash.replace(/^#\/?/, '').split('/');
  $('#backBtn').hidden = !h[0];
  if(h[0] === 'case'){
    const c = Store.cases.find(x => x.id === h[1]);
    if(!c) return go('#/');
    if(!App.c || App.c.id !== c.id){ App.c = c; App.masker = createMasker(c.maskDump); App.pack = null; }
    App.step = ['photo', 'fields', 'pack', 'get'].includes(h[2]) ? h[2] : 'photo';
    return renderCase();
  }
  App.c = null;
  if(h[0] === 'settings') return renderSettings();
  if(h[0] === 'selftest') return renderSelftest();
  return renderHome();
}
$('#backBtn').onclick = () => { if(App.c && App.step !== 'photo') go(`#/case/${App.c.id}/photo`); else go('#/'); };
$('#setBtn').onclick = () => go('#/settings');
$('#lockBtn').onclick = lockApp;
window.addEventListener('online', () => { $('#net').hidden = true; });
window.addEventListener('offline', () => { $('#net').hidden = false; });

// --- Вход ---------------------------------------------------------------------------
function renderSetup(){
  app().innerHTML = `<div class="lock">
    <h2>СНД</h2>
    <p class="muted">Пакет документов для списания материала в номенклатурное дело. Всё хранится на этом устройстве в зашифрованном виде.</p>
    <div class="card stack">
      <label class="f"><span>Придумайте PIN-код (от 6 символов)</span><input type="password" id="p1" autocomplete="new-password" inputmode="text"></label>
      <label class="f"><span>Ещё раз</span><input type="password" id="p2" autocomplete="new-password"></label>
      <button class="btn gold wide" id="pGo">Начать работу</button>
      <p class="muted">PIN-код нельзя восстановить: без него данные не открыть. Чем он длиннее, тем надёжнее защита.</p>
    </div></div>`;
  $('#pGo').onclick = async () => {
    const a = $('#p1').value;
    if(a.length < 6) return toast('PIN-код — от 6 символов', 'err');
    if(a !== $('#p2').value) return toast('PIN-коды не совпадают', 'err');
    $('#pGo').disabled = true; $('#pGo').textContent = 'Готовлю шифрование…';
    try { await Store.setup(a); await afterUnlock(); } catch(e){ toast(e.message, 'err'); render(); }
  };
}
function renderLock(){
  app().innerHTML = `<div class="lock">
    <h2>СНД</h2>
    <div class="card stack">
      <label class="f"><span>PIN-код</span><input type="password" id="pin" autocomplete="current-password"></label>
      <button class="btn gold wide" id="pinGo">Войти</button>
    </div>
    <button class="btn ghost sm" id="forgot">Забыли PIN-код? Стереть всё и начать заново</button></div>`;
  const enter = async () => {
    const b = $('#pinGo'); b.disabled = true; b.textContent = 'Проверяю…';
    try { await Store.unlock($('#pin').value); await afterUnlock(); }
    catch(e){ toast(e.message, 'err'); render(); }
  };
  $('#pinGo').onclick = enter;
  $('#pin').addEventListener('keydown', e => { if(e.key === 'Enter') enter(); });
  $('#forgot').onclick = async () => {
    if(await confirmBox('Стереть всё?', 'Все материалы, фото, шаблоны и настройки на этом устройстве будут удалены без возможности восстановления.', 'Стереть', true)){ await Store.wipe(); render(); }
  };
  $('#pin').focus();
}
async function afterUnlock(){
  await ZipIdx.init();
  const n = await Store.cleanPhotos(+Store.cfg.photoDays);
  if(n) toast(`Автоочистка: удалено старых фото — ${n}`);
  render();
}

// --- Список материалов --------------------------------------------------------------
const caseTitle = c => `КУСП № ${c.kusp || '—'}${c.pack === 'mfo' ? (c.org ? ' · ' + c.org : '') : (c.f ? ' · ' + person(c).short : '')}`;
function renderHome(q = ''){
  $('#title').textContent = 'СНД';
  const low = q.toLowerCase().trim();
  const list = Store.cases.filter(c => !low || [c.kusp, c.f, c.i, c.o, c.org, c.kusp2].join(' ').toLowerCase().includes(low));
  app().innerHTML = `
    <input type="search" id="q" placeholder="Поиск по КУСП или фамилии" value="${E(q)}" aria-label="Поиск">
    <div class="list" id="list">${list.map(c => `<button class="item" data-id="${E(c.id)}"><b>${E(caseTitle(c))}</b>
      <span class="muted">${E(fmtDate(new Date(c.updated).toISOString().slice(0, 10)))}<span class="badge">${c.pack === 'mfo' ? 'микрофинансы' : 'СНД'}</span></span></button>`).join('') ||
      `<p class="muted center">${Store.cases.length ? 'Ничего не найдено' : 'Материалов пока нет. Нажмите «Новый материал».'}</p>`}</div>
    <div class="fab"><button class="btn gold wide" id="new">Новый материал</button></div>`;
  $('#q').oninput = e => { const v = e.target.value; renderHome(v); const i = $('#q'); i.focus(); i.setSelectionRange(v.length, v.length); };
  $('#list').onclick = e => { const b = e.target.closest('[data-id]'); if(b) go(`#/case/${b.dataset.id}/photo`); };
  $('#new').onclick = async () => { const c = newCase(); c.city = Store.cfg.city; await Store.saveCase(c); go(`#/case/${c.id}/photo`); };
}

// --- Материал -----------------------------------------------------------------------
const STEPS = [['photo', 'Фото'], ['fields', 'Поля'], ['pack', 'Пакет'], ['get', 'Скачать']];
let saveTimer = null;
function saveSoon(){
  const c = App.c; if(!c) return;
  c.maskDump = App.masker.dump();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if(Store.key) Store.saveCase(c).catch(e => toast(e.message, 'err')); }, 400);
}
async function saveNow(){ clearTimeout(saveTimer); if(App.c && Store.key){ App.c.maskDump = App.masker.dump(); await Store.saveCase(App.c); } }

function renderCase(){
  const c = App.c;
  $('#title').textContent = caseTitle(c);
  const nav = `<nav class="steps">${STEPS.map(([k, t], i) => `<button data-step="${k}" ${App.step === k ? 'aria-current="step"' : ''}>${i + 1}. ${t}</button>`).join('')}</nav>`;
  app().innerHTML = nav + '<div id="stepBody"></div>' +
    '<p class="center"><button class="btn danger sm" id="delCase">Удалить всё по этому КУСП</button></p>';
  $('.steps').onclick = async e => { const b = e.target.closest('[data-step]'); if(b){ await saveNow(); go(`#/case/${c.id}/${b.dataset.step}`); } };
  $('#delCase').onclick = async () => {
    if(await confirmBox('Удалить всё по этому КУСП?', 'Будут удалены поля, распознанный текст, таблица меток и все фото этого материала.', 'Удалить', true)){
      clearTimeout(saveTimer); await Store.deleteCase(c.id); App.c = null; toast('Материал удалён'); go('#/');
    }
  };
  ({ photo: stepPhoto, fields: stepFields, pack: stepPack, get: stepGet })[App.step]();
}
const nextBtn = (to, text) => `<div class="fab"><button class="btn gold wide" data-go="${to}">${text}</button></div>`;
function bindNext(){ const b = $('[data-go]'); if(b) b.onclick = async () => { await saveNow(); go(`#/case/${App.c.id}/${b.dataset.go}`); }; }

// ----- Шаг 1. Фото -----
async function thumbs(kind){
  const c = App.c, out = [];
  for(const id of c.photos && c.photos[kind] || []){
    const p = await Store.getPhoto(id); if(!p) continue;
    const url = URL.createObjectURL(p.blob); App.urls.push(url);
    out.push(`<div class="thumb"><img src="${url}" alt="Фото"><button data-del="${E(id)}" data-kind="${kind}" aria-label="Удалить фото">×</button></div>`);
  }
  return out.join('');
}
async function stepPhoto(){
  const c = App.c; c.photos = c.photos || { kusp: [], expl: [] };
  const offline = !navigator.onLine;
  $('#stepBody').innerHTML = `
    <div class="card">
      <h3>Фабула КУСП — печатный текст</h3>
      <p class="muted">Текст распознаётся на устройстве, наружу фото не уходит.</p>
      <div class="thumbs" id="thK">${await thumbs('kusp')}</div>
      <div class="row"><button class="btn grow" data-add="kusp" data-cam="1">Снять</button><button class="btn grow" data-add="kusp">Из галереи</button></div>
      <div class="progress" id="prK" hidden><i></i></div>
      <button class="btn wide" id="ocrK" ${c.photos.kusp.length ? '' : 'disabled'}>Распознать на устройстве</button>
      <label class="f"><span>Текст фабулы (можно вставить или поправить вручную)</span><textarea id="txK" rows="6">${E(c.texts.kusp)}</textarea></label>
      <div class="stack">
        <button class="btn wide gold" id="fillAi">Заполнить поля через нейросеть</button>
        <button class="btn wide" id="fillLocal">Заполнить поля без нейросети</button>
      </div>
      <p class="muted" id="aiNote">${offline ? 'Интернета нет: работает заполнение без нейросети и ручной ввод.' : 'В нейросеть уйдёт только обезличенный текст — перед отправкой вы его увидите.'}</p>
    </div>
    <div class="card">
      <h3>Объяснение — рукопись</h3>
      <div class="note warn">Рукописный текст на устройстве распознаётся плохо. Надёжнее ввести суть пояснений вручную на шаге «Поля» либо отправить в нейросеть фото с закрашенными данными.</div>
      <div class="thumbs" id="thE">${await thumbs('expl')}</div>
      <div class="row"><button class="btn grow" data-add="expl" data-cam="1">Снять</button><button class="btn grow" data-add="expl">Из галереи</button></div>
      <div class="stack">
        <button class="btn wide gold" id="sendPhoto" ${c.photos.expl.length ? '' : 'disabled'}>Закрасить данные и отправить в нейросеть</button>
        <button class="btn wide" id="ocrE" ${c.photos.expl.length ? '' : 'disabled'}>Распознать на устройстве (если текст печатный)</button>
      </div>
      <div class="progress" id="prE" hidden><i></i></div>
      ${c.texts.expl ? `<label class="f"><span>Расшифровка объяснения (остаётся на устройстве)</span><textarea id="txE" rows="5">${E(c.texts.expl)}</textarea></label>` : ''}
    </div>` + nextBtn('fields', 'Дальше: проверить поля');
  bindNext();
  const body = $('#stepBody');
  $('#txK').oninput = e => { c.texts.kusp = e.target.value; saveSoon(); };
  if($('#txE')) $('#txE').oninput = e => { c.texts.expl = e.target.value; saveSoon(); };
  body.onclick = async e => {
    const add = e.target.closest('[data-add]'), del = e.target.closest('[data-del]');
    if(add){
      const inp = add.dataset.cam ? $('#fileCam') : $('#fileAny');
      inp.value = '';
      inp.onchange = () => addPhotos(add.dataset.add, [...inp.files]);
      inp.click();
    }
    if(del){
      await Store.deletePhoto(del.dataset.del);
      c.photos[del.dataset.kind] = c.photos[del.dataset.kind].filter(x => x !== del.dataset.del);
      await saveNow(); renderCase();
    }
  };
  $('#ocrK').onclick = () => runOcr('kusp', '#prK');
  $('#ocrE').onclick = () => runOcr('expl', '#prE');
  $('#fillLocal').onclick = () => fillFields(false);
  $('#fillAi').onclick = () => fillFields(true);
  $('#sendPhoto').onclick = sendPhotos;
}
async function addPhotos(kind, files){
  const c = App.c, gen = Store.gen;
  for(const f of files){
    try {
      // Сразу перерисовываем: поворот по EXIF применён, метаданные (в том числе геолокация) отброшены
      const cv = Photo.canvas(await Photo.decode(f), 2600);
      const blob = await Photo.blob(cv, 0.9);
      if(gen !== Store.gen) return;
      c.photos[kind].push(await Store.putPhoto(c.id, blob, { kind }));
    } catch(e){ toast(e.message, 'err'); }
  }
  await saveNow(); renderCase();
}
async function photoCanvases(kind){
  const out = [];
  for(const id of App.c.photos[kind]){ const p = await Store.getPhoto(id); if(p) out.push(Photo.canvas(await Photo.decode(p.blob), 2200)); }
  return out;
}
async function runOcr(kind, barSel){
  const c = App.c, gen = Store.gen, bar = $(barSel);
  bar.hidden = false;
  try {
    const cvs = await photoCanvases(kind), texts = [];
    for(let i = 0; i < cvs.length; i++){
      texts.push(await Ocr.read(cvs[i], p => { const el = $(barSel + ' i'); if(el) el.style.width = Math.round((i + p) / cvs.length * 100) + '%'; }));
      if(gen !== Store.gen) return;
    }
    c.texts[kind] = texts.join('\n\n').trim();
    if(!c.texts[kind]) toast('Текст не распознан. Проверьте, что фото чёткое, или введите текст вручную.', 'err');
    await saveNow(); renderCase();
  } catch(e){ if(gen === Store.gen){ toast('Распознавание не удалось: ' + e.message, 'err'); bar.hidden = true; } }
}

// Показ точного текста, который уйдёт наружу, с ручной маскировкой пропущенного
function previewText(text){
  const m = App.masker;
  const paint = t => E(t).replace(new RegExp(TOKEN_SPLIT.source, 'g'), '<mark>$1</mark>');
  return modal(`<h3>Что уйдёт в нейросеть</h3>
    <p class="muted">Получатель: ${E(Ai.recipients(false).join(' → ') || 'не выбран')}. Уходит только текст ниже. Метки в скобках стоят вместо персональных данных; таблица меток остаётся на устройстве.</p>
    <div class="payload" id="pv"></div>
    <div id="fix" hidden>
      <p class="muted">Выделите пальцем пропущенные данные и нажмите «Замаскировать».</p>
      <div class="row"><select id="mk" class="grow" aria-label="Вид данных">${MASK_KINDS.map(k => `<option>${k}</option>`).join('')}</select>
        <button class="btn sm grow" id="mkGo">Замаскировать выделенное</button></div>
    </div>
    <details><summary>Служебная инструкция (без данных)</summary><div class="in"><p class="muted">${E(AI_SYSTEM)}</p><p class="muted">${E(AI_TASK_TEXT)}</p></div></details>
    <div class="row"><button class="btn grow" data-r="">Отмена</button><button class="btn grow" id="fixBtn">Поправить</button><button class="btn grow gold" id="sendBtn">Отправить</button></div>`,
    (el, close) => {
      let masked = '';
      const show = () => { masked = m.mask(text); $('#pv', el).innerHTML = paint(masked); };
      show();
      $('#fixBtn', el).onclick = () => { $('#fix', el).hidden = false; $('#fixBtn', el).hidden = true; };
      $('#mkGo', el).onclick = () => {
        const sel = String(window.getSelection()).trim();
        if(!sel) return toast('Сначала выделите текст в окне');
        if(!m.addManual($('#mk', el).value, sel)) return toast('Этот фрагмент уже закрыт меткой');
        window.getSelection().removeAllRanges(); show(); saveSoon();
      };
      $('#sendBtn', el).onclick = () => close(masked);
    });
}
async function fillFields(useAi){
  const c = App.c, gen = Store.gen, text = [c.texts.kusp, c.texts.expl].filter(Boolean).join('\n\n').trim();
  if(!text) return toast('Сначала распознайте фото или вставьте текст фабулы');
  const m = App.masker;
  try {
    if(!useAi){
      applyFields(c, localExtract(m.mask(text)), m, 'local');
      toast('Поля заполнены по правилам, без нейросети. Проверьте их.', 'ok');
    } else {
      const masked = await previewText(text);
      if(!masked || gen !== Store.gen) return;
      $('#aiNote').textContent = 'Нейросеть отвечает — обычно до минуты…';
      const r = await aiExtractText(masked);
      if(gen !== Store.gen) return;
      applyFields(c, localExtract(masked), m, 'local');       // то, что берётся точно по меткам
      applyFields(c, r.fields, m, 'ai');
      toast('Поля заполнены. Жёлтые — проверьте особенно внимательно.', 'ok');
    }
    await fixZip(); await saveNow(); go(`#/case/${c.id}/fields`);
  } catch(e){ if(gen === Store.gen){ toast(e.message, 'err'); const n = $('#aiNote'); if(n) n.textContent = 'Можно заполнить поля без нейросети или вручную.'; } }
}
document.addEventListener('ai-note', () => { const n = $('#aiNote'); if(n && Ai.note) n.textContent = Ai.note; });

// Фото объяснения: закраска → «так увидит ИИ» → подтверждение → отправка
async function sendPhotos(){
  const c = App.c, gen = Store.gen;
  if(!Ai.ready(true).length) return toast('Нет сервиса, который читает фото. Подключите его в настройках (Mistral, Pollinations со своим ключом или свой прокси).', 'err');
  try {
    const cvs = await photoCanvases('expl'), red = [];
    for(const cv of cvs){
      const out = await Photo.redact(cv, c.headerPct ?? 28);
      if(!out || gen !== Store.gen) return;
      red.push(out);
    }
    const blobs = []; for(const r of red) blobs.push(await Photo.jpeg(r, 2.5e6, 2000));
    const urls = blobs.map(b => { const u = URL.createObjectURL(b); App.urls.push(u); return u; });
    const ok = await modal(`<h3>Так увидит нейросеть</h3>
      <div class="note warn">Фото уйдёт в сервис: ${E(Ai.recipients(true).join(' → '))}. Проверьте, что не осталось фамилий, адресов, телефонов и дат рождения. Почерк и содержание пояснений сервис увидит.</div>
      ${urls.map(u => `<img class="preview-img" src="${u}" alt="Фото с закрашенными данными">`).join('')}
      <p class="muted">Метаданные снимка (EXIF, геолокация) удалены: картинка перерисована.</p>
      <div class="row"><button class="btn grow" data-r="">Отмена</button><button class="btn grow gold" data-r="yes">Отправить</button></div>`);
    if(!ok || gen !== Store.gen) return;
    toast('Нейросеть читает фото — обычно до минуты…');
    const data = []; for(const b of blobs) data.push(await Photo.dataUrl(b));
    const r = await aiReadPhotos(data);
    if(gen !== Store.gen) return;
    c.texts.expl = r.fields.text || c.texts.expl;
    if(r.fields.explain) c.explain = r.fields.explain.replace(/\[(?:закрыто|неразборчиво)\]/g, '________');
    if(r.fields.found && !c.found) c.found = r.fields.found;
    c.uncertain = [...new Set([...(c.uncertain || []), 'explain', ...(r.fields.uncertain.includes('found') ? ['found'] : [])])];
    await saveNow(); toast('Объяснение прочитано. Проверьте текст на шаге «Поля».', 'ok'); go(`#/case/${c.id}/fields`);
  } catch(e){ if(gen === Store.gen) toast(e.message, 'err'); }
}

// ----- Шаг 2. Поля -----
// Индекс под улицу и дом: исправления пользователя → таблица; введённое вручную не трогаем
async function fixZip(force){
  const c = App.c;
  if(c.zipSrc === 'manual' && !force) return;
  const hit = ZipIdx.lookup(c.street, c.house);
  if(hit){ c.zip = hit.zip; c.zipSrc = hit.src; }
  else if(c.zipSrc !== 'manual'){ c.zip = ''; c.zipSrc = ''; }
}
const zipNote = c => c.zipSrc === 'fix' ? 'из ваших исправлений' : c.zipSrc === 'table' ? 'из таблицы по дому' : c.zipSrc === 'street' ? 'по улице — проверьте дом' :
  c.zipSrc === 'manual' ? 'введён вручную, запомнен для этого дома' : 'не найден — введите, приложение запомнит';
function stepFields(){
  const c = App.c, mfo = c.pack === 'mfo', d = k => (c.uncertain || []).includes(k) ? ' doubt' : '';
  const inp = (k, label, type = 'text', extra = '') => `<label class="f${d(k)}"><span>${label}</span><input type="${type}" data-k="${k}" value="${E(c[k] || '')}" ${extra}></label>`;
  const area = (k, label, rows = 4) => `<label class="f${d(k)}"><span>${label}</span><textarea data-k="${k}" rows="${rows}">${E(c[k] || '')}</textarea></label>`;
  $('#stepBody').innerHTML = `
    ${(c.uncertain || []).length ? '<div class="note warn">Жёлтые поля нейросеть заполнила неуверенно — проверьте их по материалу.</div>' : ''}
    <div class="card">
      <h3>${mfo ? 'Представитель организации (если есть)' : 'Заявитель'}</h3>
      ${inp('f', 'Фамилия (в именительном падеже)')}
      <div class="grid2">${inp('i', 'Имя')}${inp('o', 'Отчество')}</div>
      <div class="grid2">${inp('birth', 'Дата рождения', 'date')}${inp('phone', 'Телефон', 'tel')}</div>
      <label class="f"><span>Пол (для «Уважаемый/Уважаемая»)</span><select data-k="sex"><option value="">определить по отчеству</option><option value="m" ${c.sex === 'm' ? 'selected' : ''}>мужской</option><option value="f" ${c.sex === 'f' ? 'selected' : ''}>женский</option></select></label>
    </div>
    <div class="card">
      <h3>Адрес ${mfo ? 'организации' : 'заявителя'}</h3>
      ${inp('city', 'Населённый пункт', 'text', 'placeholder="г. Абакан"')}
      <div class="grid3">${inp('street', 'Улица', 'text', 'placeholder="ул. Пушкина"')}${inp('house', 'Дом')}${inp('flat', 'Квартира')}</div>
      <div class="row"><div class="grow">${inp('zip', 'Индекс', 'text', 'inputmode="numeric" maxlength="6"')}</div><button class="btn sm" id="zipFind">Подобрать</button></div>
      <p class="muted" id="zipNote">Индекс: ${E(zipNote(c))}.</p>
    </div>
    <div class="card">
      <h3>КУСП и сообщение</h3>
      <div class="grid2">${inp('kusp', 'Номер КУСП', 'text', 'inputmode="numeric"')}${inp('kuspDate', 'Дата КУСП', 'date')}</div>
      <div class="grid2">${inp('msgDate', 'Дата сообщения', 'date')}${inp('msgTime', 'Время', 'time')}</div>
      ${area('fabula', 'Суть обращения — продолжает «поступило сообщение о том, что …»', 4)}
      ${area('explain', 'Что пояснил заявитель — продолжает «пояснил, что …»', 4)}
      ${area('found', 'Что установлено — продолжает «установлено, что …» (пусто — типовая формулировка)', 3)}
    </div>` + nextBtn('pack', 'Дальше: выбрать пакет');
  bindNext();
  $('#stepBody').oninput = async e => {
    const k = e.target.dataset.k; if(!k) return;
    c[k] = e.target.value.trim ? e.target.value : e.target.value;
    c.uncertain = (c.uncertain || []).filter(x => x !== k);
    const lab = e.target.closest('label'); if(lab) lab.classList.remove('doubt');
    if(k === 'zip'){ c.zipSrc = /^\d{6}$/.test(c.zip) ? 'manual' : ''; if(c.zipSrc) await ZipIdx.remember(c.street, c.house, c.zip); $('#zipNote').textContent = `Индекс: ${zipNote(c)}.`; }
    if(k === 'street' || k === 'house'){ if(c.zipSrc !== 'manual'){ await fixZip(); $('[data-k=zip]').value = c.zip || ''; $('#zipNote').textContent = `Индекс: ${zipNote(c)}.`; } }
    if(k === 'f' || k === 'kusp') $('#title').textContent = caseTitle(c);
    saveSoon();
  };
  $('#zipFind').onclick = async () => {
    await fixZip(true); $('[data-k=zip]').value = c.zip || ''; $('#zipNote').textContent = `Индекс: ${zipNote(c)}.`;
    if(!c.zip) toast('В таблице нет этого адреса. Введите индекс — приложение запомнит его для этого дома.'); saveSoon();
  };
}

// ----- Шаг 3. Пакет -----
function stepPack(){
  const c = App.c, cfg = Store.cfg, mfo = c.pack === 'mfo';
  const exI = c.executor ?? cfg.executor, sgI = c.signer ?? (mfo ? cfg.signerMfo : cfg.signer);
  $('#stepBody').innerHTML = `
    <div class="card">
      <h3>Вид пакета</h3>
      <label class="chk"><input type="radio" name="pack" value="snd" ${mfo ? '' : 'checked'}><span>Списание в номенклатурное дело<small>Уведомление, рапорт на СНД с резолюцией «В дело ${E(cfg.nd)}», рапорт по результатам проверки</small></span></label>
      <label class="chk"><input type="radio" name="pack" value="mfo" ${mfo ? 'checked' : ''}><span>Микрофинансы<small>Невозврат займа, ст. 159.1 УК РФ: рапорт и уведомление без «Исп.» и телефона</small></span></label>
    </div>
    ${mfo ? `<div class="card"><label class="f"><span>Наименование организации</span><input type="text" data-k="org" value="${E(c.org)}" placeholder="ООО МКК «…»"></label></div>` : `
    <div class="card">
      <label class="chk"><input type="checkbox" data-b="join" ${c.join ? 'checked' : ''}><span>Приобщить к другому КУСП<small>Добавит рапорт о приобщении</small></span></label>
      ${c.join ? `<div class="grid2"><label class="f"><span>Номер КУСП, к которому приобщается</span><input type="text" data-k="kusp2" inputmode="numeric" value="${E(c.kusp2)}"></label>
        <label class="f"><span>Его дата</span><input type="date" data-k="kusp2Date" value="${E(c.kusp2Date)}"></label></div>` : ''}
      <label class="chk"><input type="checkbox" data-b="byPhone" ${c.byPhone ? 'checked' : ''}><span>Пояснения получены по телефону<small>Добавит телефонограмму</small></span></label>
    </div>`}
    <div class="card">
      <label class="f"><span>Исполнитель</span><select data-n="executor">${cfg.executors.map((x, i) => `<option value="${i}" ${i === exI ? 'selected' : ''}>${E(x.rank + ' ' + x.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Уведомление подписывает</span><select data-n="signer">${cfg.signers.map((x, i) => `<option value="${i}" ${i === sgI ? 'selected' : ''}>${E(x.lines.join(' ') + ' ' + x.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Дата документов</span><input type="date" data-k="docDate" value="${E(c.docDate)}"></label>
      ${mfo ? '' : `<label class="f"><span>Разъяснение прав в уведомлении (пусто — подберётся по сути обращения)</span><textarea data-k="rights" rows="5" placeholder="${E(rightsDefault(c, cfg))}">${E(c.rights || '')}</textarea></label>`}
    </div>
    <div class="card flat"><p class="muted">В пакете: ${packDocs(c).map(n => E(DOCS[n].title)).join('; ')}.</p></div>` + nextBtn('get', 'Собрать документы');
  bindNext();
  const b = $('#stepBody');
  b.onchange = e => {
    const t = e.target;
    if(t.name === 'pack'){ c.pack = t.value; c.signer = null; saveSoon(); stepPack(); }
    if(t.dataset.b){ c[t.dataset.b] = t.checked; saveSoon(); stepPack(); }
    if(t.dataset.n){ c[t.dataset.n] = +t.value; saveSoon(); }
  };
  b.oninput = e => { const k = e.target.dataset.k; if(k){ c[k] = e.target.value; saveSoon(); } };
}

// ----- Шаг 4. Скачать -----
async function stepGet(){
  const c = App.c, body = $('#stepBody');
  body.innerHTML = '<p class="muted center">Собираю документы…</p>';
  let pack;
  try { await saveNow(); pack = App.pack = await buildPack(c, Store.cfg); }
  catch(e){ body.innerHTML = `<div class="note warn">${E(e.message)}</div>`; return; }
  const bad = pack.docs.reduce((n, d) => n + d.checks.filter(x => !x.ok).length, 0);
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.docx', { type: DOCX_MIME })] }));
  body.innerHTML = `
    <div class="note ${bad ? 'warn' : ''}">${bad ? `Проверка оформления: замечаний — ${bad}. Документы можно скачать, но сначала посмотрите красные строки.` : 'Проверка оформления пройдена: все правила соблюдены.'}</div>
    <div class="card stack">
      <button class="btn gold wide" data-dl="all">Скачать одним файлом</button>
      ${canShare ? '<button class="btn wide" data-share="all">Поделиться одним файлом</button>' : ''}
    </div>
    ${pack.docs.map((d, i) => `<details ${d.checks.some(x => !x.ok) ? 'open' : ''}><summary>${E(d.title)}${d.checks.some(x => !x.ok) ? ' — есть замечания' : ''}</summary><div class="in">
      <div class="row"><button class="btn sm grow" data-dl="${i}">Скачать</button>${canShare ? `<button class="btn sm grow" data-share="${i}">Поделиться</button>` : ''}</div>
      <ul class="checks">${d.checks.map(x => `<li><span class="${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✕'}</span><span>${E(x.rule)}${x.ok ? '' : `<small>${E(x.note)}</small>`}</span></li>`).join('')}</ul>
    </div></details>`).join('')}
    <p class="muted">Шрифт документов — PT Astra Serif. Он должен быть установлен на компьютере, где файл открывают и печатают.</p>`;
  const fileOf = k => k === 'all' ? { bytes: pack.merged, name: pack.mergedName } : { bytes: pack.docs[+k].bytes, name: pack.docs[+k].fileName };
  body.onclick = async e => {
    const dl = e.target.closest('[data-dl]'), sh = e.target.closest('[data-share]');
    if(dl){ const f = fileOf(dl.dataset.dl); downloadBlob(new Blob([f.bytes], { type: DOCX_MIME }), f.name); }
    if(sh){
      const f = fileOf(sh.dataset.share);
      try { await navigator.share({ files: [new File([f.bytes], f.name, { type: DOCX_MIME })], title: f.name }); }
      catch(err){ if(err.name !== 'AbortError') toast('Не получилось поделиться — скачайте файл', 'err'); }
    }
  };
}

// --- Настройки ----------------------------------------------------------------------
function renderSettings(){
  $('#title').textContent = 'Настройки';
  const cfg = Store.cfg, a = cfg.ai;
  const exRows = cfg.executors.map((x, i) => `<div class="card" data-ex="${i}">
      <label class="chk"><input type="radio" name="exDef" value="${i}" ${cfg.executor === i ? 'checked' : ''}><span>По умолчанию</span></label>
      <div class="grid2"><label class="f"><span>Звание</span><input type="text" data-f="rank" value="${E(x.rank)}"></label><label class="f"><span>И.О. Фамилия</span><input type="text" data-f="name" value="${E(x.name)}"></label></div>
      <div class="grid2"><label class="f"><span>Телефон</span><input type="tel" data-f="phone" value="${E(x.phone)}"></label><label class="f"><span>Почта</span><input type="email" data-f="email" value="${E(x.email)}"></label></div>
      <button class="btn danger sm" data-exdel="${i}">Удалить</button></div>`).join('');
  const sgRows = cfg.signers.map((x, i) => `<div class="card" data-sg="${i}">
      <label class="f"><span>Должность (каждая строка отдельно)</span><textarea data-f="lines" rows="2">${E(x.lines.join('\n'))}</textarea></label>
      <div class="grid2"><label class="f"><span>Звание (можно пусто)</span><input type="text" data-f="rank" value="${E(x.rank)}"></label><label class="f"><span>И.О. Фамилия</span><input type="text" data-f="name" value="${E(x.name)}"></label></div>
      <button class="btn danger sm" data-sgdel="${i}">Удалить</button></div>`).join('');
  const sgOpt = sel => cfg.signers.map((x, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${E(x.name)}</option>`).join('');
  const aiRows = a.order.map((id, i) => { const p = AI_PROVIDERS[id]; return `<div class="card" data-ai="${id}">
      <label class="chk"><input type="checkbox" data-on="${id}" ${a.on[id] ? 'checked' : ''}><span>${i + 1}. ${E(p.name)}<small>${E(p.hint)}</small></span></label>
      ${id === 'proxy' ? `<label class="f"><span>Адрес прокси (https://…)</span><input type="url" data-aik="proxyUrl" value="${E(a.proxyUrl)}"></label>
        <label class="f"><span>Код доступа (если задан на сервере)</span><input type="password" data-aik="proxyCode" value="${E(a.proxyCode)}" autocomplete="off"></label>` : ''}
      ${id === 'custom' ? `<label class="f"><span>Адрес (https://…/chat/completions)</span><input type="url" data-aik="customUrl" value="${E(a.customUrl)}"></label>` : ''}
      ${p.needKey ? `<label class="f"><span>Ключ</span><input type="password" data-key="${id}" value="${E(a.keys[id] || '')}" autocomplete="off"></label>` : ''}
      ${id !== 'free' ? `<label class="f"><span>Модель${id === 'proxy' ? ' (пусто — как на сервере)' : ''}</span><input type="text" data-model="${id}" value="${E(a.models[id] || '')}" placeholder="${E(p.model)}"></label>` : ''}
      <div class="row"><button class="btn sm" data-up="${id}" ${i ? '' : 'disabled'}>Выше</button><button class="btn sm" data-down="${id}" ${i < a.order.length - 1 ? '' : 'disabled'}>Ниже</button></div></div>`; }).join('');
  app().innerHTML = `
    <details><summary>Исполнители</summary><div class="in" id="exBox">${exRows}<button class="btn wide" id="exAdd">Добавить исполнителя</button>
      <div class="grid2"><label class="f"><span>Должность, строка 1</span><input type="text" data-cfg="pos1" value="${E(cfg.pos1)}"></label><label class="f"><span>Должность, строка 2</span><input type="text" data-cfg="pos2" value="${E(cfg.pos2)}"></label></div></div></details>
    <details><summary>Подписанты уведомления</summary><div class="in" id="sgBox">${sgRows}<button class="btn wide" id="sgAdd">Добавить подписанта</button>
      <div class="grid2"><label class="f"><span>По умолчанию</span><select data-cfgn="signer">${sgOpt(cfg.signer)}</select></label><label class="f"><span>Для микрофинансов</span><select data-cfgn="signerMfo">${sgOpt(cfg.signerMfo)}</select></label></div></div></details>
    <details><summary>Реквизиты</summary><div class="in">
      <label class="f"><span>Кому адресованы рапорты (каждая строка отдельно)</span><textarea id="chief" rows="4">${E(cfg.chief.join('\n'))}</textarea></label>
      <div class="grid2"><label class="f"><span>Орган</span><input type="text" data-cfg="org" value="${E(cfg.org)}"></label><label class="f"><span>Номенклатурное дело №</span><input type="text" data-cfg="nd" value="${E(cfg.nd)}"></label></div>
      <label class="f"><span>Город по умолчанию</span><input type="text" data-cfg="city" value="${E(cfg.city)}"></label>
      <label class="chk"><input type="checkbox" id="emblem" ${cfg.emblem ? 'checked' : ''}><span>Герб в шапке уведомления</span></label></div></details>
    <details><summary>Нейросеть</summary><div class="in" id="aiBox">
      <p class="muted">Сервисы пробуются по порядку; при ошибке приложение переходит к следующему. Ключи хранятся в зашифрованной базе на этом устройстве и уходят только на адрес своего сервиса.</p>${aiRows}</div></details>
    <details><summary>Шаблоны документов</summary><div class="in" id="tplBox"><p class="muted">Загрузка…</p></div></details>
    <details><summary>Индексы</summary><div class="in" id="zipBox"></div></details>
    <details><summary>Защита и хранение</summary><div class="in">
      <div class="grid2"><label class="f"><span>Автоблокировка, минут</span><input type="number" min="1" max="120" data-cfgn="lockMin" value="${E(cfg.lockMin)}"></label>
        <label class="f"><span>Удалять фото старше, дней (0 — не удалять)</span><input type="number" min="0" max="3650" data-cfgn="photoDays" value="${E(cfg.photoDays)}"></label></div>
      <div class="stack"><button class="btn wide" id="pinChange">Сменить PIN-код</button><button class="btn wide" id="bkOut">Сохранить резервную копию</button>
        <button class="btn wide" id="bkIn">Восстановить из копии</button><button class="btn danger wide" id="wipe">Стереть всё на этом устройстве</button></div>
      <p class="muted">База зашифрована AES-GCM, ключ выводится из PIN-кода (PBKDF2, 600 000 итераций). Резервная копия — тоже зашифрованный файл со своим паролем.</p></div></details>
    <details><summary>Самопроверка</summary><div class="in"><p class="muted">Пять выдуманных фабул проходят маскировку, тестовый пакет собирается и проверяется по правилам оформления.</p>
      <button class="btn wide" id="selfGo">Запустить самотест</button></div></details>
    <p class="muted center">Версия ${E(APP_VERSION)}. Работает на устройстве; без интернета доступны ручной ввод, распознавание печатного текста и сборка документов.</p>`;
  const save = () => Store.saveCfg().catch(e => toast(e.message, 'err'));
  const root = app();
  root.oninput = e => {
    const t = e.target, ex = t.closest('[data-ex]'), sg = t.closest('[data-sg]');
    if(ex && t.dataset.f) cfg.executors[+ex.dataset.ex][t.dataset.f] = t.value.trim();
    else if(sg && t.dataset.f) cfg.signers[+sg.dataset.sg][t.dataset.f] = t.dataset.f === 'lines' ? t.value.split('\n').map(x => x.trim()).filter(Boolean) : t.value.trim();
    else if(t.dataset.cfg) cfg[t.dataset.cfg] = t.value.trim();
    else if(t.dataset.cfgn) cfg[t.dataset.cfgn] = +t.value || 0;
    else if(t.id === 'chief') cfg.chief = t.value.split('\n').map(x => x.trim()).filter(Boolean);
    else if(t.dataset.key) a.keys[t.dataset.key] = t.value.trim();
    else if(t.dataset.model) a.models[t.dataset.model] = t.value.trim();
    else if(t.dataset.aik) a[t.dataset.aik] = t.value.trim();
    else return;
    save();
  };
  root.onchange = e => {
    const t = e.target;
    if(t.name === 'exDef') cfg.executor = +t.value;
    else if(t.id === 'emblem') cfg.emblem = t.checked;
    else if(t.dataset.on) a.on[t.dataset.on] = t.checked;
    else return;
    save();
  };
  root.onclick = async e => {
    const t = e.target.closest('button'); if(!t) return;
    const move = (id, d) => { const i = a.order.indexOf(id); a.order.splice(i, 1); a.order.splice(i + d, 0, id); };
    if(t.id === 'exAdd') cfg.executors.push({ rank: '', name: '', phone: '', email: '' });
    else if(t.dataset.exdel){ if(cfg.executors.length < 2) return toast('Нужен хотя бы один исполнитель'); cfg.executors.splice(+t.dataset.exdel, 1); cfg.executor = Math.min(cfg.executor, cfg.executors.length - 1); }
    else if(t.id === 'sgAdd') cfg.signers.push({ lines: [], rank: '', name: '' });
    else if(t.dataset.sgdel){ if(cfg.signers.length < 2) return toast('Нужен хотя бы один подписант'); cfg.signers.splice(+t.dataset.sgdel, 1); cfg.signer = Math.min(cfg.signer, cfg.signers.length - 1); cfg.signerMfo = Math.min(cfg.signerMfo, cfg.signers.length - 1); }
    else if(t.dataset.up) move(t.dataset.up, -1);
    else if(t.dataset.down) move(t.dataset.down, 1);
    else return;
    await save();
    const open = $$('details[open] > summary').map(s => s.textContent);
    renderSettings();
    $$('details').forEach(d => { if(open.includes($('summary', d).textContent)) d.open = true; });
  };
  renderTplBox(); renderZipBox();
  $('#selfGo').onclick = () => go('#/selftest');
  $('#pinChange').onclick = async () => {
    const old = await askPassword('Текущий PIN-код', 'Введите действующий PIN-код.'); if(!old) return;
    const nw = await askPassword('Новый PIN-код', 'От 6 символов. Восстановить его нельзя.', true); if(!nw) return;
    try { toast('Меняю PIN-код…'); await Store.changePin(old, nw); toast('PIN-код изменён', 'ok'); } catch(err){ toast(err.message, 'err'); }
  };
  $('#bkOut').onclick = async () => {
    const pw = await askPassword('Пароль резервной копии', 'Копия шифруется этим паролем. Без него файл не открыть.', true); if(!pw) return;
    try { toast('Готовлю копию…'); downloadBlob(await Store.exportBackup(pw), `snd-backup-${today()}.sndbak`); } catch(err){ toast(err.message, 'err'); }
  };
  $('#bkIn').onclick = () => {
    const inp = $('#fileBackup'); inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0]; if(!f) return;
      const pw = await askPassword('Пароль резервной копии', 'Введите пароль, с которым копия была сохранена.'); if(!pw) return;
      try { toast('Восстанавливаю…'); const r = await Store.importBackup(f, pw); await ZipIdx.init(); toast(`Восстановлено: материалов — ${r.cases}, фото — ${r.photos}`, 'ok'); renderSettings(); }
      catch(err){ toast(err.message, 'err'); }
    };
    inp.click();
  };
  $('#wipe').onclick = async () => {
    if(await confirmBox('Стереть всё?', 'Материалы, фото, шаблоны, настройки и PIN-код будут удалены без возможности восстановления.', 'Стереть', true)){ await Store.wipe(); lockApp(); }
  };
}
async function renderTplBox(){
  const box = $('#tplBox'); if(!box) return;
  const rows = [];
  for(const [name, d] of Object.entries(DOCS)) rows.push(`<div class="card"><b>${E(d.title)}</b> <span class="badge">${(await Tpl.isOwn(name)) ? 'свой шаблон' : 'стартовый'}</span>
    <div class="row"><button class="btn sm grow" data-tup="${name}">Загрузить свой .docx</button><button class="btn sm grow" data-tdl="${name}">Скачать текущий</button><button class="btn sm grow" data-trs="${name}">Вернуть стартовый</button></div></div>`);
  box.innerHTML = `<p class="muted">Откройте шаблон в Word, поправьте текст и оформление, сохраните и загрузите обратно. Метки в фигурных скобках приложение заменяет данными; оформление остаётся вашим.</p>${rows.join('')}
    <details><summary>Метки для шаблонов</summary><div class="in"><table class="t">${TAG_HELP.map(([t, h]) => `<tr><td><code>${E(t)}</code></td><td>${E(h)}</td></tr>`).join('')}</table></div></details>`;
  box.onclick = async e => {
    const b = e.target.closest('button'); if(!b) return;
    if(b.dataset.tdl){ downloadBlob(new Blob([await Tpl.get(b.dataset.tdl)], { type: DOCX_MIME }), `Шаблон — ${DOCS[b.dataset.tdl].file}.docx`); }
    if(b.dataset.trs){ await Tpl.reset(b.dataset.trs); toast('Возвращён стартовый шаблон'); renderTplBox(); }
    if(b.dataset.tup){
      const name = b.dataset.tup, inp = $('#fileDocx'); inp.value = '';
      inp.onchange = async () => {
        const f = inp.files[0]; if(!f) return;
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          // Пробная сборка на выдуманных данных: шаблон с ошибкой в метках не сохраняем
          const probe = new window.docxtemplater(new PizZip(bytes), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
          probe.render(buildData(selftestCase(), Store.cfg));
          await Tpl.set(name, bytes); toast('Шаблон сохранён', 'ok'); renderTplBox();
        } catch(err){ toast(tplError(err, name).message, 'err'); }
      };
      inp.click();
    }
  };
}
function renderZipBox(){
  const box = $('#zipBox'); if(!box) return;
  const fix = Object.entries(ZipIdx.fix || {}), n = Object.keys((ZipIdx.base && ZipIdx.base.streets) || {}).length;
  box.innerHTML = `<p class="muted">${n ? `В начальной таблице улиц: ${n}. Источник: ${E(ZipIdx.base.source || '')}.` : 'Начальная таблица пуста — индексы запоминаются по мере работы: введённый индекс сохраняется для улицы и дома.'} Ваши исправления важнее таблицы.</p>
    <div class="grid3"><label class="f"><span>Улица</span><input type="text" id="zs" placeholder="ул. Пушкина"></label><label class="f"><span>Дом</span><input type="text" id="zh"></label><label class="f"><span>Индекс</span><input type="text" id="zz" inputmode="numeric" maxlength="6"></label></div>
    <button class="btn wide" id="zAdd">Запомнить индекс</button>
    <table class="t">${fix.map(([k, z]) => `<tr><td>${E(k.split('|')[0])}, д. ${E(k.split('|')[1] || '—')}</td><td>${E(z)}</td><td><button class="btn sm danger" data-zdel="${E(k)}">Удалить</button></td></tr>`).join('')}</table>`;
  $('#zAdd').onclick = async () => {
    if(!/^\d{6}$/.test($('#zz').value) || !$('#zs').value.trim()) return toast('Укажите улицу и индекс из шести цифр', 'err');
    await ZipIdx.remember($('#zs').value, $('#zh').value, $('#zz').value); renderZipBox();
  };
  box.onclick = async e => { const b = e.target.closest('[data-zdel]'); if(b){ delete ZipIdx.fix[b.dataset.zdel]; await Store.setKV('zipfix', ZipIdx.fix); renderZipBox(); } };
}

// --- Самотест (экран) ---------------------------------------------------------------
async function renderSelftest(){
  $('#title').textContent = 'Самопроверка';
  app().innerHTML = '<p class="muted center">Выполняю…</p>';
  const r = await runSelftest();
  app().innerHTML = `
    <div class="note ${r.ok ? '' : 'warn'}">${r.ok ? 'Самопроверка пройдена: утечек нет, правила оформления соблюдены.' : 'Есть замечания — см. ниже.'}</div>
    <h2>Маскировка: что ушло бы наружу</h2>
    ${r.mask.map(m => `<div class="card"><h3>${E(m.title)}</h3><div class="payload">${E(m.out)}</div>
      <p class="${m.leaks.length ? '' : 'muted'}">${m.leaks.length ? 'УТЕЧКА: ' + E(m.leaks.join(', ')) : `Проверено настоящих значений: ${m.checked} — ни одно не ушло.`}</p></div>`).join('')}
    <h2>Тестовый пакет на выдуманных данных</h2>
    ${r.docs.map(d => `<div class="card"><h3>${E(d.title)}</h3><ul class="checks">${d.checks.map(x => `<li><span class="${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✕'}</span><span>${E(x.rule)}${x.ok ? '' : `<small>${E(x.note)}</small>`}</span></li>`).join('')}</ul></div>`).join('')}
    <button class="btn wide" id="selfDl">Скачать тестовый пакет (.docx)</button>`;
  $('#selfDl').onclick = () => downloadBlob(new Blob([r.merged], { type: DOCX_MIME }), 'Самотест — тестовый пакет.docx');
}

// --- Запуск -------------------------------------------------------------------------
const APP_VERSION = '1.0';
if('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
if(!window.isSecureContext || !crypto.subtle){
  app().innerHTML = '<div class="note warn">Приложение работает только по защищённому адресу (https://). Откройте его по ссылке хостинга.</div>';
} else render().catch(e => { app().innerHTML = `<div class="note warn">${E(e.message)}</div>`; });
