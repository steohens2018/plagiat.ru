// Слой нейросети. ИИ нужен только чтобы достать поля из текста или фото; документы собирает код.
// Несколько провайдеров с автоматическим переключением при ошибке. Наружу уходит только
// обезличенный текст (метки вместо данных) или фото с закрашенными областями — и только
// после того, как пользователь увидел, что именно уйдёт, и подтвердил отправку.
'use strict';

// Состояние сервисов проверено в ноябре 2026 г. (см. ИНСТРУКЦИЯ.md). Модели и адреса можно сменить в настройках.
const AI_PROVIDERS = {
  free: { name: 'Без ключа — Pollinations (только текст)', url: 'https://text.pollinations.ai/openai', model: 'openai', vision: false, needKey: false,
    hint: 'Работает сразу, без регистрации. Один запрос раз в 30 секунд. Фото не читает — только обезличенный текст.' },
  mistral: { name: 'Mistral — свой ключ (читает фото)', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', vision: true, needKey: true,
    hint: 'Бесплатный режим для своего ключа. Ключ: console.mistral.ai → API Keys.' },
  pollinations: { name: 'Pollinations — свой ключ (читает фото)', url: 'https://gen.pollinations.ai/v1/chat/completions', model: 'openai', vision: true, needKey: true,
    hint: 'Ключ sk_… из enter.pollinations.ai.' },
  proxy: { name: 'Свой прокси — ключ хранится на сервере', url: '', model: '', vision: true, needKey: false,
    hint: 'Адрес вашего воркера из папки worker/. Ключ нейросети лежит на сервере, в приложение его вводить не нужно.' },
  openrouter: { name: 'OpenRouter — свой ключ (читает фото)', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/free', vision: true, needKey: true,
    hint: 'Бесплатные модели :free, 50 запросов в сутки. По замерам осени 2026 г. из России отвечает 403 — работает только через прокси или VPN.' },
  custom: { name: 'Другой сервис, совместимый с OpenAI', url: '', model: '', vision: true, needKey: true, hint: 'Адрес вида https://…/v1/chat/completions, ключ и название модели.' }
};

const Ai = {
  note: null,                       // строка состояния («ждём лимит…») для интерфейса
  freeNextAt: 0,

  conf(id){
    const a = Store.cfg.ai, p = AI_PROVIDERS[id];
    return { id, name: p.name, vision: p.vision, needKey: p.needKey,
      url: id === 'proxy' ? a.proxyUrl : id === 'custom' ? a.customUrl : p.url,
      key: id === 'proxy' ? a.proxyCode : (a.keys[id] || ''), model: a.models[id] || p.model };
  },
  // Какие провайдеры готовы к работе, в порядке из настроек
  ready(vision){
    const a = Store.cfg.ai;
    return a.order.filter(id => AI_PROVIDERS[id] && a.on[id]).map(id => this.conf(id))
      .filter(p => /^https:\/\//.test(p.url || '') && (!p.needKey || p.key) && (!vision || p.vision));
  },
  recipients(vision){ return this.ready(vision).map(p => p.name.split(' — ')[0].replace(/^Без ключа$/, 'Pollinations (без ключа)')); },

  // Понятная причина ошибки из тела ответа — и что с этим делать
  explain(status, body, p, hasImage){
    let msg = '';
    try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || j.detail || ''; if(typeof msg !== 'string') msg = JSON.stringify(msg); }
    catch(e){ msg = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200); }
    msg = msg.slice(0, 300);
    const tail = msg ? ` Ответ сервиса: «${msg}».` : '';
    if(status === 0) return 'нет связи с сервисом: нет интернета или сервис недоступен у вашего провайдера.';
    if(status === 400) return `сервис не принял запрос (ошибка 400).${tail} ` + (hasImage
      ? 'Чаще всего это слишком большое фото или модель, которая не читает изображения. Что сделать: выбрать в настройках модель с поддержкой фото или отправить текст вместо фото.'
      : 'Проверьте название модели в настройках.');
    if(status === 401) return `ключ не подошёл (401).${tail} Проверьте ключ в настройках.`;
    if(status === 403) return `доступ запрещён (403).${tail} Ключ не имеет прав либо сервис закрыт для вашего региона.`;
    if(status === 402 || status === 429) return `исчерпан лимит запросов (${status}).${tail} Подождите минуту или переключитесь на другой сервис.`;
    if(status === 404) return `адрес или модель не найдены (404).${tail} Проверьте адрес сервиса и название модели.`;
    if(status === 413) return 'запрос слишком большой (413). Уменьшите фото или отправьте текст.';
    if(status >= 500) return `сервис временно не отвечает (${status}). Попробуйте позже.`;
    return `ошибка ${status}.${tail}`;
  },

  async once(p, messages, json, signal){
    const body = { model: p.model, messages, temperature: 0.1 };
    if(p.id === 'free') body.private = true;                       // не публиковать запрос в общей ленте сервиса
    if(json && p.id !== 'free') body.response_format = { type: 'json_object' };
    const headers = { 'Content-Type': 'application/json' };
    if(p.key) headers[p.id === 'proxy' ? 'X-Access-Code' : 'Authorization'] = p.id === 'proxy' ? p.key : 'Bearer ' + p.key;
    let r;
    try { r = await fetch(p.url, { method: 'POST', headers, body: JSON.stringify(body), signal, referrerPolicy: 'no-referrer' }); }
    catch(e){ if(e.name === 'AbortError') throw e; return { status: 0, text: '' }; }
    const text = await r.text();
    if(!r.ok) return { status: r.status, text, retry: +r.headers.get('retry-after') || 0 };
    try {
      const j = JSON.parse(text), out = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      // «Ответ» с просьбой пополнить баланс — это тоже лимит
      if(p.id === 'free' && (!out || (j.usage && j.usage.total_tokens === 0) || /enough credits|pollen/i.test(out))) return { status: 429, text: out || '', retry: 31 };
      if(typeof out !== 'string' || !out.trim()) return { status: 502, text: 'пустой ответ' };
      return { status: 200, out };
    } catch(e){ return { status: 502, text: 'ответ не в формате JSON' }; }
  },

  // Запрос с переключением между провайдерами. images — массив data:URL уже подготовленных JPEG.
  async call({ system, user, images = [], json = true }){
    const vision = images.length > 0, list = this.ready(vision), gen = Store.gen;
    if(!navigator.onLine) throw new Error('Нет интернета. Поля можно заполнить вручную — документы соберутся и без сети.');
    if(!list.length) throw new Error(vision
      ? 'Нет сервиса, который читает фото. В настройках подключите Mistral, Pollinations со своим ключом или свой прокси — либо распознайте текст на устройстве.'
      : 'Не выбран ни один сервис нейросети. Включите хотя бы один в настройках.');
    const content = vision ? [{ type: 'text', text: user }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : user;
    const messages = [{ role: 'system', content: system }, { role: 'user', content }];
    const fails = [];
    for(const p of list){
      for(let attempt = 0; attempt < 2; attempt++){
        if(gen !== Store.gen) throw new Error('Приложение заблокировано — запрос отменён');
        if(p.id === 'free'){
          const wait = this.freeNextAt - Date.now();
          if(wait > 0){ this.setNote(`Сервис без ключа отвечает раз в 30 секунд — ждём ${Math.ceil(wait / 1000)} с…`); await new Promise(r => setTimeout(r, wait)); }
          this.freeNextAt = Date.now() + 31000;
        }
        this.setNote(`${p.name.split(' — ')[0]}: ждём ответ…`);
        const r = await this.once(p, messages, json);
        if(r.status === 200){ this.setNote(null); return { text: r.out, provider: p.name }; }
        if((r.status === 429 || r.status === 402) && attempt === 0 && p.id === 'free'){ this.freeNextAt = Date.now() + Math.min(40, r.retry || 31) * 1000; continue; }
        fails.push(`${p.name.split(' — ')[0]}: ${this.explain(r.status, r.text, p, vision)}`);
        break;
      }
    }
    this.setNote(null);
    throw new Error('Нейросеть не ответила.\n' + fails.join('\n') + '\nПоля можно заполнить вручную.');
  },
  setNote(t){ this.note = t; document.dispatchEvent(new CustomEvent('ai-note')); }
};

// --- Строгий JSON по схеме ----------------------------------------------------------
const SCHEMA_TEXT = { applicant: 'ФИО', birth: 'ДР', address: 'АДРЕС', phone: 'ТЕЛ', kusp: 'КУСП', kusp_date: 'date', msg_date: 'date', msg_time: 'time',
  fabula: 'text', explain: 'text', found: 'text', uncertain: 'list' };
const SCHEMA_PHOTO = { text: 'text', explain: 'text', found: 'text', uncertain: 'list' };

function parseJsonAnswer(text){
  const t = String(text || '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if(a < 0 || b <= a) throw new Error('Нейросеть ответила не в формате JSON. Попробуйте ещё раз или заполните поля вручную.');
  try { return JSON.parse(t.slice(a, b + 1)); }
  catch(e){ throw new Error('Ответ нейросети не разобрался как JSON. Попробуйте ещё раз или заполните поля вручную.'); }
}
// Проверка по схеме: лишние поля отбрасываются, неверные типы и форматы уходят в «сомнительные»
function validateAnswer(obj, schema){
  const out = {}, doubt = new Set();
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Ответ нейросети не похож на карточку. Попробуйте ещё раз.');
  for(const [k, type] of Object.entries(schema)){
    let v = obj[k];
    if(type === 'list'){ (Array.isArray(v) ? v : []).forEach(x => { if(typeof x === 'string' && x in schema) doubt.add(x); }); continue; }
    if(v == null) v = '';
    if(typeof v !== 'string'){ v = typeof v === 'number' ? String(v) : ''; doubt.add(k); }
    v = v.trim().slice(0, 4000);
    if(/^(нет|не указано|неизвестно|—|-|null|none)$/i.test(v)) v = '';
    if(v && MASK_KINDS.includes(type)){
      const m = new RegExp(`\\[${type}_\\d+\\]`).exec(v);
      if(m) v = m[0]; else doubt.add(k);                // вместо метки пришёл произвольный текст
    }
    if(v && type === 'date'){ const iso = toIso(v); if(iso) v = fmtDate(iso); else { v = ''; doubt.add(k); } }
    if(v && type === 'time'){ const m = /(\d{1,2})[:. ч]+\s*(\d{2})/.exec(v); if(m) v = `${pad2(m[1])}:${m[2]}`; else { v = ''; doubt.add(k); } }
    out[k] = v;
  }
  out.uncertain = [...doubt];
  return out;
}

const AI_SYSTEM = 'Ты помогаешь сотруднику полиции заполнить карточку материала проверки. Персональные данные в тексте заменены метками в квадратных скобках: [ФИО_1], [АДРЕС_1], [ТЕЛ_1], [ДР_1], [КУСП_1] и другими. ' +
  'Метки переписывай точно как есть: не склоняй, не расшифровывай, не выдумывай новых. Ничего не добавляй от себя: чего нет в тексте — оставь пустой строкой. Ответь строго одним JSON-объектом без пояснений и без разметки.';
const AI_TASK_TEXT = `Заполни JSON по тексту ниже. Поля:
"applicant" — метка ФИО заявителя (того, от кого поступило сообщение);
"birth" — метка даты рождения заявителя;
"address" — метка адреса заявителя;
"phone" — метка телефона заявителя;
"kusp" — метка номера КУСП;
"kusp_date" — дата регистрации в КУСП, ДД.ММ.ГГГГ;
"msg_date" — дата поступления сообщения, ДД.ММ.ГГГГ; "msg_time" — время, ЧЧ:ММ;
"fabula" — суть обращения одним-двумя предложениями; продолжает фразу «поступило сообщение о том, что …», начинается со строчной буквы;
"explain" — что пояснил заявитель; продолжает фразу «пояснил, что …»;
"found" — что установлено проверкой; продолжает фразу «установлено, что …»;
"uncertain" — список названий полей, в которых ты не уверен.`;
const AI_TASK_PHOTO = `На фото — объяснение, написанное от руки по-русски. Персональные данные закрашены чёрным. Прочитай текст и ответь JSON с полями:
"text" — дословная расшифровка; закрашенные места пиши как [закрыто], неразборчивые слова — как [неразборчиво];
"explain" — суть пояснений в одном-трёх предложениях; продолжает фразу «пояснил, что …», начинается со строчной буквы;
"found" — что из этого следует для проверки (если понятно), продолжает фразу «установлено, что …»;
"uncertain" — список названий полей, в которых ты не уверен.`;

// Обезличенный текст → поля (метки ещё не раскрыты)
async function aiExtractText(masked){
  const r = await Ai.call({ system: AI_SYSTEM, user: AI_TASK_TEXT + '\n\nТекст:\n' + masked });
  return { fields: validateAnswer(parseJsonAnswer(r.text), SCHEMA_TEXT), provider: r.provider };
}
// Закрашенные фото → расшифровка и суть
async function aiReadPhotos(dataUrls){
  const r = await Ai.call({ system: AI_SYSTEM, user: AI_TASK_PHOTO, images: dataUrls });
  return { fields: validateAnswer(parseJsonAnswer(r.text), SCHEMA_PHOTO), provider: r.provider };
}

// --- Без нейросети: то же самое по меткам и простым правилам -------------------------
function localExtract(masked){
  const first = (kind, after) => {
    const re = new RegExp(`\\[${kind}_\\d+\\]`, 'g');
    if(after){ const m = new RegExp(`(?:${after})[^\\[\\n]{0,40}(\\[${kind}_\\d+\\])`, 'iu').exec(masked); if(m) return m[1]; }
    return (masked.match(re) || [''])[0];
  };
  const out = { applicant: first('ФИО', 'от гр|сообщени[ея]|заявлени[ея]|обращени[ея]|гр-к|гр-н|гр\\.'), birth: first('ДР'), address: first('АДРЕС', 'прожива|адрес|зарегистрир'),
    phone: first('ТЕЛ'), kusp: first('КУСП'), kusp_date: '', msg_date: '', msg_time: '', fabula: '', explain: '', found: '', uncertain: [] };
  let m = /\[КУСП_\d+\]\s*от\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(masked); if(m) out.kusp_date = fmtDate(toIso(m[1]));
  m = /(\d{1,2}\.\d{1,2}\.\d{4})\s*(?:г\.|года)?\s*в\s*(\d{1,2})\s*(?:час\.?|ч\.|:)\s*(\d{2})/.exec(masked);
  if(m){ out.msg_date = fmtDate(toIso(m[1])); out.msg_time = `${pad2(m[2])}:${m[3]}`; }
  m = /о том,?\s*что\s+([\s\S]{10,600}?[.!?])(?=\s+(?:[А-ЯЁ\[]|$)|$)/u.exec(masked); if(m) out.fabula = m[1].trim();
  m = /поясни[лв][а-яё]*,?\s*что\s+([\s\S]{10,600}?[.!?])(?=\s|$)/iu.exec(masked); if(m) out.explain = m[1].trim();
  return out;
}

// Поля с метками → материал. Метки раскрываются здесь, на устройстве.
function applyFields(c, fields, masker, source){
  const set = (k, v) => { if(v && (!c[k] || source === 'ai')) c[k] = v; };
  const doubt = new Set(fields.uncertain || []);
  const MAP = { applicant: ['f', 'i', 'o'], birth: ['birth'], address: ['street', 'house', 'flat'], phone: ['phone'], kusp: ['kusp'], kusp_date: ['kuspDate'],
    msg_date: ['msgDate'], msg_time: ['msgTime'], fabula: ['fabula'], explain: ['explain'], found: ['found'] };
  if(fields.applicant){
    const p = masker.personOf(fields.applicant);
    if(p && p.f){ set('f', p.f); set('i', p.i); set('o', p.o); if(!p.i || !p.o) doubt.add('applicant'); }
    else if(TOKEN_SPLIT.test(fields.applicant)) doubt.add('applicant');
    else { const w = fields.applicant.split(/\s+/); set('f', w[0]); set('i', w[1] || ''); set('o', w[2] || ''); }
  }
  const plain = t => masker.unmask(t, { plain: true });
  if(fields.birth){ const iso = toIso(plain(fields.birth)); if(iso) set('birth', iso); else doubt.add('birth'); }
  if(fields.address){
    const a = parseAddress(plain(fields.address));
    set('street', a.street); set('house', a.house); set('flat', a.flat); if(a.city) set('city', a.city);
    if(!a.house) doubt.add('address');
  }
  if(fields.phone) set('phone', plain(fields.phone));
  if(fields.kusp) set('kusp', plain(fields.kusp).replace(/\D/g, ''));
  if(fields.kusp_date) set('kuspDate', toIso(fields.kusp_date));
  if(fields.msg_date) set('msgDate', toIso(fields.msg_date));
  if(fields.msg_time) set('msgTime', fields.msg_time);
  // Модель иногда повторяет вводную фразу («поступило сообщение о том, что …») — в шаблоне она уже есть
  const LEAD = { fabula: /^(?:поступило\s+)?(?:сообщение|заявление|обращение)?[^.]{0,60}?о том,?\s*что\s+/iu, explain: /^(?:он[а]?\s+)?поясн[а-яё]+,?\s*что\s+/iu, found: /^(?:в ходе проверки\s+)?установлено,?\s*что\s+/iu };
  for(const k of ['fabula', 'explain', 'found']) if(fields[k]) set(k, masker.unmask(fields[k].replace(LEAD[k], '')).replace(/\[(?:закрыто|неразборчиво)\]/g, '________'));
  c.uncertain = [...new Set([...(source === 'ai' ? [] : c.uncertain || []), ...[...doubt].flatMap(k => MAP[k] || [])])];
}
