// Маскировка персональных данных перед отправкой текста в нейросеть.
// ФИО, даты рождения, адреса, телефоны, паспорта, КУСП, госномера, карты и почта
// заменяются метками [ФИО_1], [АДРЕС_1]… Один человек (в любом падеже, с инициалами
// или полностью) получает одну метку. Таблица «метка → значение» живёт только
// в памяти и в зашифрованной базе, наружу не уходит. Порядок правил важен:
// почта → карты → телефоны → паспорта → даты рождения → КУСП → госномера → адреса → люди → номера.
'use strict';

const TOKEN_RE = /\[(?:ФИО|ДР|АДРЕС|ТЕЛ|ПАСПОРТ|КУСП|АВТО|КАРТА|EMAIL|НОМЕР)_\d+\]/g;
const TOKEN_SPLIT = /(\[(?:ФИО|ДР|АДРЕС|ТЕЛ|ПАСПОРТ|КУСП|АВТО|КАРТА|EMAIL|НОМЕР)_\d+\])/;
const MASK_KINDS = ['ФИО', 'ДР', 'АДРЕС', 'ТЕЛ', 'ПАСПОРТ', 'КУСП', 'АВТО', 'КАРТА', 'EMAIL', 'НОМЕР'];

function createMasker(saved){
  const items = new Map();      // метка → { kind, value }
  const byKey = new Map();      // вид|ключ → метка
  const persons = [];           // люди: { token, sur, surKey, name, nameKey, patr, i1, i2 }
  const manual = [];            // замаскировано вручную: { text, token }
  const counters = {};
  const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const tc = w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;   // ИВАНОВ → Иванов

  const newToken = (kind, value) => {
    counters[kind] = (counters[kind] || 0) + 1;
    const t = `[${kind}_${counters[kind]}]`;
    items.set(t, { kind, value });
    return t;
  };
  const simple = (kind, value, key) => {
    const k = kind + '|' + (key ?? norm(value));
    if(!byKey.has(k)) byKey.set(k, newToken(kind, value.trim()));
    return byKey.get(k);
  };

  // --- Люди -------------------------------------------------------------------
  // Основа фамилии: Иванов, Иванова, Иванову, Ивановым, Ивановой → «иванов»
  const surStem = w => {
    let l = norm(w);
    for(const e of ['ого', 'ому', 'ыми', 'ым', 'им', 'ом', 'ой', 'ою', 'ую', 'ая', 'яя', 'ий', 'ый', 'ем', 'а', 'у', 'е', 'ы', 'я', 'ю', 'и', 'ь', 'й']){
      if(l.length - e.length >= 3 && l.endsWith(e)){ l = l.slice(0, -e.length); break; }
    }
    return l;
  };
  const nameStem = w => {
    let l = norm(w);
    for(const e of ['ой', 'ою', 'ей', 'ею', 'ем', 'ом', 'ью', 'ия', 'ии', 'ию', 'а', 'я', 'у', 'ю', 'е', 'ы', 'и', 'й', 'ь']){
      if(l.length - e.length >= 2 && l.endsWith(e)){ l = l.slice(0, -e.length); break; }
    }
    return l.slice(0, 3);
  };
  const ini = w => w ? norm(w)[0] : '';
  const fit = (a, b) => !a || !b || a === b;
  function personToken(p){
    const sur = p.sur ? tc(p.sur) : '', name = p.name ? tc(p.name) : '', patr = p.patr ? tc(p.patr) : '';
    const q = { sur, surKey: sur ? surStem(sur) : '', name, nameKey: name ? nameStem(name) : '', patr,
      i1: ini(name) || ini(p.i1), i2: ini(patr) || ini(p.i2) };
    let cand = [];
    if(q.surKey) cand = persons.filter(x => x.surKey === q.surKey && fit(x.i1, q.i1) && fit(x.i2, q.i2) && fit(x.nameKey, q.nameKey));
    else if(q.i1 && q.i2) cand = persons.filter(x => x.i1 === q.i1 && x.i2 === q.i2 && fit(x.nameKey, q.nameKey));
    else if(q.nameKey) cand = persons.filter(x => x.nameKey === q.nameKey);
    if(!q.surKey && cand.length > 1) cand = [];                       // «Иван Иванович» подходит двоим — заводим отдельную метку
    let x = cand[0];
    if(!x){
      x = Object.assign(q, { token: newToken('ФИО', '') });
      persons.push(x);
    } else {
      // Дополняем запись: полное ФИО важнее инициалов
      if(q.sur && (!x.sur || (q.patr && !x.patr))){ x.sur = q.sur; x.surKey = q.surKey; }
      if(q.name && (!x.name || (q.patr && !x.patr))){ x.name = q.name; x.nameKey = q.nameKey; }
      if(q.patr && !x.patr) x.patr = q.patr;
      x.i1 = x.i1 || q.i1; x.i2 = x.i2 || q.i2;
    }
    items.get(x.token).value = personValue(x);
    return x.token;
  }
  // Значение для таблицы и формы — в именительном падеже, если его можно определить по отчеству
  function personParts(x){
    if(x.sur && x.name && x.patr) return toNominative(x.sur, x.name, x.patr);
    return [x.sur, x.name, x.patr];
  }
  function personValue(x){
    const [f, i, o] = personParts(x);
    if(f && i) return [f, i, o].filter(Boolean).join(' ');
    const inis = [x.i1, x.i2].filter(Boolean).map(c => c.toUpperCase() + '.').join('');
    return [inis, f].filter(Boolean).join(' ') || [i, o].filter(Boolean).join(' ');
  }

  const W = '[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?';
  const PATR = '[А-ЯЁ][а-яё]+(?:(?:ович|евич|ьич)(?:а|у|ем|е)?|(?:овн|евн|ичн|иничн)(?:а|ы|е|у|ой|ою))|(?:Ильич|Кузьмич|Лукич|Фомич|Никитич|Саввич)(?:а|у|ем|е)?';
  const nameForms = (() => {
    const set = new Set();
    const add = (n, sex) => {
      set.add(n); set.add(declineName(n, sex, 'gen')); set.add(declineName(n, sex, 'dat'));
      const l = n.toLowerCase(), base = n.slice(0, -1);
      if(/[бвгджзклмнпрстфхцчшщ]$/.test(l)) ['ом', 'е'].forEach(x => set.add(n + x));
      else if(/а$/.test(l)) ['ой', 'у'].forEach(x => set.add(base + x));
      else if(/я$/.test(l)) ['ей', 'ю'].forEach(x => set.add(base + x));
      else if(/[йь]$/.test(l)) ['ем', 'е', 'ью'].forEach(x => set.add(base + x));
    };
    NAMES_M.forEach(n => add(n, 'm')); NAMES_F.forEach(n => add(n, 'f'));
    return [...set].filter(x => x && x.length > 2).sort((a, b) => b.length - a.length);
  })();
  const NAME = '(?:' + nameForms.map(escRe).join('|') + ')';
  const SUR_END = '(?:ов|ев|ёв|ин|ын|енко|ук|юк|чук|ян|янц|швили|дзе|ых|их)(?:а|у|ым|ом|ой|ою|е|ы)?|[а-яё]+(?:ск|цк)(?:ий|ая|ого|ому|им|ом|ой|ую)';
  // Слова с «фамильными» окончаниями, которые фамилиями не являются
  const NOT_SUR = '(?!(?:Росси|Федерал|Министерств|Управлен|Отдел|Москов|Хакас|Абакан|Красноярск|Сибир|Государств|Конституц|Верховн|Областн|Районн|Городск|Краев|Республик|Советск|Ленинск|Октябрьск|Центральн|Русск|Российск|Полици|Дежурн|Банк|Магазин|Интернет|Телефон|Вчера|Сегодня|Затем|Потом|Однако|Также|Кроме|После|Около|Данн|Указанн|Неизвестн|Гражданин|Гражданк|Заявител|Сотрудник|Участков|Сбербанк|Тинькофф|Альфа|Почта|Ущерб|Кража|Хищен|Автомобил|Квартир|Велосипед|Мужчин|Женщин|Сосед|Един|Один|Никто|Причин))';
  const B = '(?<![\\p{L}\\d])', A = '(?![\\p{L}\\d])';
  const CUE = '(' + ('гр\\.|гр-н[а-яё]*|гр-к[а-яё]*|граждан[а-яё]*|сосед[а-яё]*|супруг[а-яё]*|жен[аыеуой]{1,2}|муж(?:а|у|ем|е)?|брат[а-яё]*|сестр[а-яё]*|сын[а-яё]*|доч[а-яё]*|отц[а-яё]*|отец|матер[а-яё]*|мать|знаком[а-яё]*|заявител[а-яё]*|потерпевш[а-яё]*|свидетел[а-яё]*|сожител[а-яё]*|водител[а-яё]*|продав[а-яё]*|владел[а-яё]*|собственник[а-яё]*|по фамилии|по имени').split('|').map(x => `[${x[0].toUpperCase()}${x[0]}]${x.slice(1)}`).join('|') + ')';

  const personRules = [
    // Полностью: Фамилия Имя Отчество (в любом падеже) и ИМЯ ОТЧЕСТВО ФАМИЛИЯ прописными
    [new RegExp(`${B}(${W})\\s+(${W})\\s+(${PATR})(?:\\s+(?:оглы|кызы))?${A}`, 'gu'), m => personToken({ sur: m[1], name: m[2], patr: m[3] })],
    [/(?<![\p{L}\d])([А-ЯЁ]{2,}(?:-[А-ЯЁ]{2,})?)\s+([А-ЯЁ]{2,})\s+([А-ЯЁ]{2,}(?:ВИЧ|ВНА|ЧНА|ИЧ|ВИЧА|ВНЫ|ЧНЫ|ВИЧУ|ВНЕ|ЧНЕ|ВНОЙ|ВИЧЕМ))(?![\p{L}\d])/gu,
      m => personToken({ sur: m[1], name: m[2], patr: m[3] })],
    // Имя Отчество Фамилия
    [new RegExp(`${B}(${NAME})\\s+(${PATR})\\s+${NOT_SUR}(${W})${A}`, 'gu'), m => personToken({ name: m[1], patr: m[2], sur: m[3] })],
    // Фамилия И.О., И.О. Фамилия, прописными тоже
    [new RegExp(`${B}(${W}|[А-ЯЁ]{2,})\\s+([А-ЯЁ])\\.\\s?([А-ЯЁ])\\.?(?![а-яё])`, 'gu'), m => personToken({ sur: m[1], i1: m[2], i2: m[3] })],
    [new RegExp(`${B}([А-ЯЁ])\\.\\s?([А-ЯЁ])\\.\\s?(${W}|[А-ЯЁ]{2,})${A}`, 'gu'), m => personToken({ sur: m[3], i1: m[1], i2: m[2] })],
    // Имя Отчество
    [new RegExp(`${B}(${W})\\s+(${PATR})(?:\\s+(?:оглы|кызы))?${A}`, 'gu'), m => personToken({ name: m[1], patr: m[2] })],
    // Фамилия Имя и Имя Фамилия (имя — из словаря)
    [new RegExp(`${B}${NOT_SUR}([А-ЯЁ][а-яё]{2,}(?:${SUR_END}))\\s+(${NAME})${A}`, 'gu'), m => personToken({ sur: m[1], name: m[2] })],
    [new RegExp(`${B}(${NAME})\\s+${NOT_SUR}([А-ЯЁ][а-яё]{2,}(?:${SUR_END}))${A}`, 'gu'), m => personToken({ name: m[1], sur: m[2] })],
    // После «гр.», «сосед», «супруга»… — фамилия и, возможно, имя
    [new RegExp(`(?<![\\p{L}])${CUE}(\\s+)(${W})(?:\\s+(${NAME}))?${A}`, 'gu'),
      m => m[1] + m[2] + personToken(m[4] ? { sur: m[3], name: m[4] } : (new RegExp('^' + NAME + '$', 'u').test(m[3]) ? { name: m[3] } : { sur: m[3] }))],
    // Одиночная фамилия по типичным окончаниям
    [new RegExp(`${B}${NOT_SUR}([А-ЯЁ][а-яё]{2,}(?:${SUR_END}))${A}`, 'gu'), m => personToken({ sur: m[1] })],
    [/(?<![\p{L}\d])([А-ЯЁ]{3,}(?:ОВ|ЕВ|ЁВ|ИН|ЫН|ЕНКО|УК|ЮК|ЯН|ИХ|ЫХ|СКИЙ|ЦКИЙ|СКАЯ|ЦКАЯ)(?:А|У|ЫМ|ОМ|ОЙ|Е|Ы)?)(?![\p{L}\d])/gu, m => personToken({ sur: m[1] })],
    // Имя из словаря само по себе
    [new RegExp(`${B}(${NAME})${A}`, 'gu'), m => personToken({ name: m[1] })]
  ];

  // --- Адреса -----------------------------------------------------------------
  const STREET_WORD = '(?:ул\\.|улиц[аеыу]|пр\\.|пр-т[а-я]*|просп\\.|проспект[а-я]*|пер\\.|переул[а-я]*|мкр\\.?|микрорайон[а-я]*|ш\\.|шоссе|б-р|бульвар[а-я]*|наб\\.|пл\\.|площад[а-я]*|снт|тер\\.|туп\\.|проезд[а-я]*|кв-л|квартал[а-я]*)';
  const HOUSE = '(?:,?\\s*(?:д\\.|дом[а-я]*)?\\s*\\d{1,4}(?:\\s?[А-Яа-я](?![а-яё]))?(?:\\s?[/-]\\s?\\d{1,4})?(?:,?\\s*(?:корп\\.|корпус|к\\.|стр\\.|строение)\\s*\\d+)?(?:,?\\s*(?:кв\\.|квартира|ком\\.|комн\\.|комната|оф\\.|офис)\\s*\\d{1,4})?)';
  const PLACE = '(?:(?:г\\.|гор\\.|город|с\\.|село|п\\.|пос\\.|пгт\\.?|д\\.|дер\\.|аал|рп\\.?)\\s*[А-ЯЁ][а-яё-]+(?:\\s[А-ЯЁ][а-яё-]+)?,?\\s*)';
  const streetAlt = STREETS.slice().sort((a, b) => b.length - a.length).map(s => escRe(s).replace(/[её]/g, '[её]')).join('|');
  function addrKey(s){
    const l = norm(s).replace(new RegExp(`(?:${PLACE})`, 'giu'), ' ');
    const nums = l.match(/\d+[а-я]?/g) || [];
    const street = l.replace(new RegExp(STREET_WORD, 'giu'), ' ').replace(/(?:д\.|дом|кв\.|квартира|корп\.|к\.|стр\.)/g, ' ').replace(/[\d,.\/-]+[а-я]?(?=\s|$)/g, ' ').replace(/[^а-я\s-]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2).map(w => w.slice(0, Math.max(4, w.length - 2))).join(' ');
    return street + '|' + nums.join('|');
  }
  const addr = m => simple('АДРЕС', m[0].replace(/[,\s]+$/, ''), addrKey(m[0])) + (/[,\s]+$/.exec(m[0]) || [''])[0];
  const addrRules = [
    [new RegExp(`${PLACE}?${STREET_WORD}\\s*[А-ЯЁ0-9][А-Яа-яЁё0-9. -]{1,40}?${HOUSE}(?![\\p{L}\\d])`, 'gu'), addr],
    [new RegExp(`${PLACE}?${STREET_WORD}\\s*[А-ЯЁ][а-яё-]+(?:\\s[А-ЯЁ][а-яё-]+)?(?![\\p{L}])`, 'gu'), addr],
    [new RegExp(`${B}(?:${streetAlt})${HOUSE}(?![\\p{L}\\d])`, 'gu'), addr],
    [new RegExp(`${PLACE}(?:д\\.|дом)\\s*\\d{1,4}[а-я]?(?:\\s?[/-]\\s?\\d{1,4})?(?:,?\\s*(?:кв\\.|квартира)\\s*\\d{1,4})?`, 'gu'), addr],
    [/(?<!\p{L})(?:д\.|дом|кв\.|квартир[аеуы]|комн?\.)\s*\d{1,4}[а-я]?(?![\p{L}\d])/giu, addr]
  ];

  // --- Остальное --------------------------------------------------------------
  const digits = s => s.replace(/\D/g, '');
  const MONTHS = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
  const BORN = '(?:г\\.?\\s?р\\.?|года\\s+рождения|г\\.\\s*рождения|г/р)';
  const DATE = `\\d{1,2}[./]\\d{1,2}[./](?:\\d{4}|\\d{2})|\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}`;
  const PL = '[АВЕКМНОРСТУХABEKMHOPCTYX]';
  const rules = [
    [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, m => simple('EMAIL', m[0])],
    [/(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?:[ -]?\d{2,3})?(?!\d)/gu, m => simple('КАРТА', m[0], digits(m[0]))],
    [/(?:\+7|(?<!\d)[78])[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu, m => simple('ТЕЛ', m[0], digits(m[0]).slice(-10))],
    [/(?:(?:\+7|(?<!\d)8)\s?)?\(\d{3,5}\)\s?\d[\d-]{4,8}\d/gu, m => simple('ТЕЛ', m[0], digits(m[0]))],
    [/(?<![\d.,/-])\d{2,3}-\d{2}-\d{2}(?![\d./-])/gu, m => simple('ТЕЛ', m[0], digits(m[0]))],
    [/(?<!\d)\d{2}\s?\d{2}\s?(?:№|N|номер)?\s?\d{6}(?!\d)/gu, m => simple('ПАСПОРТ', m[0], digits(m[0]))],
    [new RegExp(`(?<!\\d)(${DATE})(?:\\s*(?:г\\.|года))?(?=\\s*${BORN})`, 'giu'), m => simple('ДР', m[0], norm(m[1]))],
    [new RegExp(`((?:родил[а-яё]*|рождения:?|д\\.\\s?р\\.:?)\\s*)(${DATE})`, 'giu'), m => m[1] + simple('ДР', m[2])],
    [new RegExp(`(?<!\\d)(?:19|20)\\d{2}(?=\\s*${BORN})`, 'giu'), m => simple('ДР', m[0])],
    [/(КУСП\s*(?:№|N)?\s*)(\d+)/giu, m => m[1] + simple('КУСП', m[2])],
    [new RegExp(`(?<![\\p{L}\\d])${PL}\\s?\\d{3}\\s?${PL}{2}\\s?\\d{2,3}(?:\\s*(?:регион|рус|RUS))?(?![\\p{L}\\d])`, 'giu'), m => simple('АВТО', m[0], norm(m[0]).replace(/\s|регион|рус|rus/g, ''))],
    ...addrRules,
    ...personRules,
    [/№\s*[\w/-]*\d[\w/-]*/gu, m => simple('НОМЕР', m[0], digits(m[0]) || norm(m[0]))],
    [/(?<![\p{L}\d])(?=[A-Z0-9/-]*\d)(?=[A-Z0-9/-]*[A-Z])[A-Z0-9/-]{7,}(?![\p{L}\d])/gu, m => simple('НОМЕР', m[0])],
    [/(?<![\d.,:])\d{6,}(?![\d.,:]\d)/gu, m => simple('НОМЕР', m[0])]
  ];

  // Текст → текст с метками. Уже поставленные метки не трогаем.
  function mask(text){
    let out = String(text || '');
    const pass = (re, fn) => {
      out = out.split(TOKEN_SPLIT).map(seg => TOKEN_SPLIT.test(seg) && seg.startsWith('[') ? seg
        : seg.replace(re, (...a) => { const m = a.slice(0, a.findIndex(x => typeof x === 'number')); return fn(m); })).join('');
    };
    for(const x of manual) pass(new RegExp(escRe(x.text).replace(/\s+/g, '\\s+').replace(/[её]/g, '[её]'), 'giu'), () => x.token);
    for(const [re, fn] of rules) pass(re, fn);
    return out;
  }
  // «Пропущенное можно выделить и замаскировать»: фрагмент закрывается меткой выбранного вида
  function addManual(kind, text){
    const t = String(text || '').trim();
    if(t.length < 2 || TOKEN_RE.test(t)){ TOKEN_RE.lastIndex = 0; return null; }
    TOKEN_RE.lastIndex = 0;
    const token = kind === 'ФИО' ? personToken({ sur: t.split(/\s+/)[0], name: t.split(/\s+/)[1], patr: t.split(/\s+/)[2] }) : simple(kind, t);
    manual.push({ text: t, token });
    if(kind === 'ФИО') items.get(token).value = items.get(token).value || t;
    return token;
  }

  // Метки → значения (на устройстве). ФИО ставится в форме «И.О. Фамилия»; после слов,
  // требующих родительного падежа («гр.», «от», «у», «заявление»…), — в родительном.
  const GEN_CUE = /(?:^|[\s(«"])(?:гр\.|гр-на|гр-ки|от|у|для|без|со слов|в отношении|заявлени[ея]|сообщени[ея]|обращени[ея]|объяснени[ея]|пояснени[ея]|имущество|принадлежащ[а-яё]+|опросе|телефон)\s*$/iu;
  function unmask(text, { plain = false } = {}){
    return String(text || '').replace(TOKEN_RE, (t, pos, all) => {
      const it = items.get(t);
      if(!it) return t;
      if(it.kind !== 'ФИО' || plain) return it.value;
      const x = persons.find(p => p.token === t);
      if(!x || !x.sur) return it.value;
      const [f, i, o] = personParts(x);
      const sex = sexOf({ i, o });
      const inis = [x.i1, x.i2].filter(Boolean).map(c => c.toUpperCase() + '.').join('');
      const sur = GEN_CUE.test(all.slice(Math.max(0, pos - 40), pos)) ? declineSurname(f, sex, 'gen') : f;
      return [inis, sur].filter(Boolean).join(' ');
    });
  }
  const table = () => [...items].map(([token, v]) => ({ token, kind: v.kind, value: v.value }));
  const personOf = token => { const x = persons.find(p => p.token === token); if(!x) return null; const [f, i, o] = personParts(x); return { f: f || '', i: i || '', o: o || '' }; };
  // Сохранение и восстановление таблицы (внутри зашифрованного материала)
  const dump = () => ({ items: [...items], byKey: [...byKey], persons, manual, counters });
  if(saved && saved.items){
    saved.items.forEach(([k, v]) => items.set(k, v)); saved.byKey.forEach(([k, v]) => byKey.set(k, v));
    persons.push(...saved.persons); manual.push(...saved.manual); Object.assign(counters, saved.counters);
  }
  return { mask, unmask, addManual, table, personOf, dump, valueOf: t => (items.get(t) || {}).value || '' };
}

// Проверка утечки: нет ли в тексте, уходящем наружу, какого-либо из настоящих значений.
// Сравниваем без регистра и «ё»; для номеров — ещё и по одним цифрам.
function findLeaks(outgoing, secrets){
  const low = String(outgoing).toLowerCase().replace(/ё/g, 'е');
  const dig = low.replace(/[^\d]/g, '');
  return secrets.filter(s => {
    const v = String(s).toLowerCase().replace(/ё/g, 'е').trim();
    if(!v) return false;
    if(low.includes(v)) return true;
    const d = v.replace(/\D/g, '');
    return d.length >= 6 && d.length === v.replace(/[\s()+-]/g, '').length && dig.includes(d);
  });
}
