// Сборка документов. Документ собирает код по шаблону DOCX (docxtemplater + PizZip),
// нейросеть в этом не участвует: она только помогает заполнить поля формы.
// Здесь же — склейка пакета в один файл и проверка правил оформления.
'use strict';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FONT_NAME = 'PT Astra Serif';

const DOCS = {
  uvedomlenie:        { title: 'Уведомление заявителю', file: 'Уведомление', kind: 'notice' },
  raport_snd:         { title: 'Рапорт на списание в НД', file: 'Рапорт СНД', kind: 'report' },
  raport_proverka:    { title: 'Рапорт по результатам проверки', file: 'Рапорт по результатам проверки', kind: 'report' },
  raport_priobshenie: { title: 'Рапорт о приобщении к другому КУСП', file: 'Рапорт о приобщении', kind: 'report' },
  telefonogramma:     { title: 'Телефонограмма', file: 'Телефонограмма', kind: 'phone' },
  mfo_raport:         { title: 'Рапорт (микрофинансы)', file: 'Рапорт МФО', kind: 'report' },
  mfo_uvedomlenie:    { title: 'Уведомление (микрофинансы)', file: 'Уведомление МФО', kind: 'notice-mfo' }
};
// Состав пакета по виду и галочкам
function packDocs(c){
  if(c.pack === 'mfo') return ['mfo_raport', 'mfo_uvedomlenie'];
  return ['uvedomlenie', 'raport_snd', 'raport_proverka', ...(c.join ? ['raport_priobshenie'] : []), ...(c.byPhone ? ['telefonogramma'] : [])];
}

// Шаблоны: свой (загружен в настройках, лежит в зашифрованной базе) или стартовый из папки templates/
const Tpl = {
  async get(name){
    const own = await Store.getKV('tpl:' + name);
    if(own) return own;
    const r = await fetch(`templates/${name}.docx`);
    if(!r.ok) throw new Error(`Не найден шаблон «${DOCS[name].title}»`);
    return new Uint8Array(await r.arrayBuffer());
  },
  async isOwn(name){ return !!(await Store.getKV('tpl:' + name)); },
  set(name, bytes){ return Store.setKV('tpl:' + name, bytes); },
  reset(name){ return Store.delKV('tpl:' + name); }
};

// Разъяснение прав в уведомлении — по словам фабулы; текст можно поправить в форме
function rightsDefault(c, cfg){
  const t = [c.fabula, c.explain, c.found].join(' ').toLowerCase();
  const items = [];
  if(/долг|займ|заём|расписк|договор|аренд|кредит|вернуть деньги|не возвращ|ремонт|ущерб|залив|затоп|покупк|товар|услуг/.test(t))
    items.push('обратиться в суд с исковым заявлением в порядке гражданского судопроизводства для защиты нарушенных прав и возмещения ущерба (ст. 11, 12, 15 ГК РФ)');
  if(/оскорб|унизил|нецензур/.test(t))
    items.push('обратиться в прокуратуру с заявлением о привлечении к ответственности за оскорбление, поскольку дела об административных правонарушениях по ст. 5.61 КоАП РФ возбуждаются прокурором (ст. 28.4 КоАП РФ)');
  if(/управляющ|жкх|коммунал|подъезд|лифт|отоплен/.test(t))
    items.push('обратиться в управляющую организацию, а также в Государственную жилищную инспекцию с письменным обращением в порядке Федерального закона от 02.05.2006 № 59-ФЗ');
  items.push('при появлении новых сведений о противоправных действиях — обратиться в полицию с заявлением о преступлении или административном правонарушении (ст. 141 УПК РФ, ст. 28.1 КоАП РФ)');
  return ['Для защиты своих прав Вы вправе:', ...items.map((x, i) => `${i + 1}) ${x}${i === items.length - 1 ? '.' : ';'}`),
    `Принятое решение Вы вправе обжаловать начальнику ${cfg.org}, в прокуратуру г. Абакана либо в суд.`].join('\n');
}

const addrLine = c => [c.street, c.house ? 'д. ' + c.house : '', c.flat ? 'кв. ' + c.flat : ''].filter(Boolean).join(', ');
const kuspLine = (n, d) => `КУСП № ${n || '_____'} от ${fmtDate(d) || '__.__.____'}`;

// Данные для шаблонов: все падежи и согласованные слова считает код
function buildData(c, cfg){
  const p = person(c), mfo = c.pack === 'mfo';
  const ex = cfg.executors[c.executor ?? cfg.executor] || cfg.executors[0] || { rank: '', name: '' };
  const sg = cfg.signers[c.signer ?? (mfo ? cfg.signerMfo : cfg.signer)] || cfg.signers[0] || { lines: [], rank: '', name: '' };
  const tm = /^(\d{1,2}):(\d{2})/.exec(c.msgTime || '');
  const em = /^\s*((?:[А-ЯЁ]\.\s?){1,2})\s*(\S+)\s*$/u.exec(ex.name || '');
  const exIns = em ? `${em[1].replace(/\s/g, '')} ${surnameIns(em[2], 'm')}` : ex.name;
  const txt = v => sentence(cont(initialsFirst(v)));
  const foundDef = mfo
    ? `между ${c.org || 'организацией'} и заёмщиком заключён договор займа, обязательства по которому не исполняются. Сведений о том, что при заключении договора заёмщик предоставил заведомо ложные или недостоверные сведения, в ходе проверки не получено`
    : 'признаков преступления или административного правонарушения не усматривается, противоправных действий не совершено';
  const lines = (sg.lines || []).filter(Boolean);
  return {
    'орган': cfg.org, 'орган_род': cfg.org, 'нд': cfg.nd, 'год': (c.docDate || today()).slice(0, 4),
    'адресат': cfg.chief.filter(Boolean),
    'кусп': kuspLine(c.kusp, c.kuspDate), 'кусп_номер': c.kusp, 'кусп_дата': fmtDate(c.kuspDate),
    'кусп2': kuspLine(c.kusp2, c.kusp2Date),
    'дата_сообщения': fmtDate(c.msgDate || c.kuspDate) || '__.__.____', 'час': tm ? pad2(tm[1]) : '__', 'мин': tm ? tm[2] : '__',
    'заявитель_им': p.full || '________', 'заявитель_род': p.has ? p.gen : '________', 'заявитель_род_полн': p.genFull || '________',
    'заявитель_дат': p.has ? p.dat : '________', 'заявитель_кратко': p.has ? p.short : '________', 'имя_отчество': p.io,
    'уважаемый': p.w.dear, 'опрошен': p.w.questioned, 'который': p.w.who, 'пояснил': p.w.explained,
    'проживающий': p.w.living, 'проживающего': p.w.livingGen, 'него': p.w.him, 'готов': p.w.ready,
    'дата_рождения': fmtDate(c.birth) || '__.__.____', 'город': c.city || cfg.city, 'адрес': addrLine(c) || '________', 'индекс': c.zip || '',
    'телефон': c.phone || '________',
    'фабула': txt(c.fabula) || '________.', 'пояснения': txt(c.explain) || '________.', 'установлено': txt(c.found || foundDef),
    'нет_сведений': `Сведений о совершении в отношении ${p.has ? p.gen : 'заявителя'} противоправных действий в ходе проверки не получено.`,
    'вывод': 'Таким образом, противоправных действий не совершено, признаков преступления или административного правонарушения не установлено.',
    'права': (c.rights || rightsDefault(c, cfg)).split(/\n+/).map(x => x.trim()).filter(Boolean),
    'исп_должность_1': cfg.pos1, 'исп_должность_2': cfg.pos2, 'исп_звание': ex.rank, 'исп_имя': ex.name,
    'исп_телефон': ex.phone || '', 'исп_почта': ex.email || '',
    'исп_твор': [cfg.pos1, cfg.pos2, rankCase(ex.rank, 'ins'), exIns].filter(Boolean).join(' '),
    'подписант_строки': sg.rank ? lines : lines.slice(0, -1), 'подписант_последняя': sg.rank || lines[lines.length - 1] || '', 'подписант_имя': sg.name,
    'дата_документа': fmtDate(c.docDate || today()),
    'по_телефону': !!c.byPhone, 'герб': cfg.emblem !== false,
    'организация': c.org || '________', 'организация_род': c.org || '________', 'представитель_род': p.has ? p.gen : '',
    'обращение': p.io ? `${p.w.dear} ${p.io}!` : 'Уважаемый заявитель!'
  };
}
const TAG_HELP = [
  ['{заявитель_им}', 'Иванов Иван Иванович'], ['{заявитель_род}', 'И.И. Иванова'], ['{заявитель_дат}', 'И.И. Иванову'], ['{заявитель_кратко}', 'И.И. Иванов'],
  ['{заявитель_род_полн}', 'Иванова Ивана Ивановича'], ['{имя_отчество}', 'Иван Иванович'], ['{уважаемый}', 'Уважаемый / Уважаемая'],
  ['{дата_рождения}', '01.02.1980'], ['{город}', 'г. Абакан'], ['{адрес}', 'ул. …, д. …, кв. …'], ['{индекс}', 'индекс заявителя'], ['{телефон}', 'телефон заявителя'],
  ['{кусп}', 'КУСП № … от …'], ['{кусп2}', 'КУСП, к которому приобщается'], ['{дата_сообщения}', 'дата'], ['{час}', 'часы'], ['{мин}', 'минуты'],
  ['{фабула}', 'суть обращения'], ['{пояснения}', 'что пояснил заявитель'], ['{установлено}', 'что установлено'], ['{#права}{.}{/права}', 'абзацы разъяснения прав'],
  ['{#адресат}{.}{/адресат}', 'строки «кому» в рапорте'], ['{нд}', '10/5'], ['{год}', 'год'], ['{орган}', 'УМВД России по г. Абакану'],
  ['{исп_должность_1}', 'УУП ОУУП и ПДН'], ['{исп_должность_2}', 'УМВД России по г. Абакану'], ['{исп_звание}', 'звание'], ['{исп_имя}', 'И.О. Фамилия'],
  ['{исп_телефон}', 'телефон исполнителя'], ['{исп_почта}', 'почта исполнителя'], ['{исп_твор}', 'должность, звание и фамилия в творительном падеже'],
  ['{#подписант_строки}{.}{/подписант_строки}', 'строки должности подписанта'], ['{подписант_последняя}', 'звание или последняя строка должности'], ['{подписант_имя}', 'И.О. Фамилия подписанта'],
  ['{дата_документа}', 'дата'], ['{#по_телефону}…{/по_телефону}', 'текст, если пояснения по телефону'], ['{#герб}…{/герб}', 'герб в шапке'],
  ['{организация}', 'наименование организации (микрофинансы)'], ['{представитель_род}', 'представитель в родительном падеже'], ['{обращение}', 'Уважаемый …!']
];

// Понятная причина ошибки шаблона
function tplError(e, name){
  const list = e && e.properties && e.properties.errors;
  const why = list ? list.map(x => x.properties && x.properties.explanation || x.message).slice(0, 3).join('; ') : (e.message || String(e));
  return new Error(`Шаблон «${DOCS[name].title}»: ${why}. Проверьте метки в фигурных скобках или верните стартовый шаблон в настройках.`);
}
async function renderDoc(name, data){
  const bytes = await Tpl.get(name);
  try {
    const doc = new window.docxtemplater(new PizZip(bytes), { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(data);
    return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
  } catch(e){ throw tplError(e, name); }
}

// --- Разбор готового файла --------------------------------------------------------
const P_RE = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function paragraphsOf(xml){
  return (xml.match(P_RE) || []).map(p => xmlText(p.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<[^>]+>/g, (m, t) => t || (m === '\t' ? '\t' : ''))));
}
function docxParts(bytes){
  const zip = new PizZip(bytes), get = n => { const f = zip.file(n); return f ? f.asText() : ''; };
  return { zip, document: get('word/document.xml'), styles: get('word/styles.xml'), footnotes: get('word/footnotes.xml') };
}

// --- Проверка правил оформления ----------------------------------------------------
// Возвращает список { rule, ok, note }. Вызывается перед скачиванием и в самотесте.
function checkDocx(bytes, name, data, c){
  const parts = docxParts(bytes), kind = DOCS[name].kind;
  const ps = paragraphsOf(parts.document).map(t => t.replace(/[  ]+/g, ' ').trim());
  const all = ps.join('\n');
  const R = [], add = (rule, ok, note = '') => R.push({ rule, ok: !!ok, note: ok ? '' : note });
  const seq = arr => { for(let i = 0; i + arr.length <= ps.length; i++) if(arr.every((x, k) => ps[i + k] === x)) return i; return -1; };

  // 1. Шрифт
  const fonts = new Set(), src = parts.document + parts.styles + parts.footnotes;
  for(const tag of src.match(/<w:rFonts[^>]*>/g) || []) for(const m of tag.matchAll(/w:(?:ascii|hAnsi|cs|eastAsia)="([^"]*)"/g)) fonts.add(m[1]);
  const theme = /<w:rFonts[^>]*Theme=/.test(src);
  const def = /<w:rPrDefault>[\s\S]*?w:ascii="PT Astra Serif"/.test(parts.styles);
  const runsNoFont = (parts.document.match(/<w:r>(?!<w:rPr>[\s\S]*?<w:rFonts)(?=<w:t|<w:rPr>(?![\s\S]*?<\/w:rPr>[\s\S]*?<w:rFonts))/g) || []).length;
  add('Шрифт PT Astra Serif во всём файле', fonts.size === 1 && fonts.has(FONT_NAME) && !theme && (def || !runsNoFont),
    [...fonts].filter(f => f !== FONT_NAME).length ? 'есть другой шрифт: ' + [...fonts].filter(f => f !== FONT_NAME).join(', ') : 'шрифт по умолчанию не задан');

  // 2. Никаких листов с картинкой: допускается только герб в шапке уведомления
  const imgs = (parts.document.match(/<w:drawing>|<w:pict>/g) || []).length;
  const big = [...parts.document.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].some(m => +m[2] > 1500000 || +m[1] > 2500000);
  const letter = kind === 'notice' || kind === 'notice-mfo';
  add('Нет листа с картинкой', imgs <= (letter && data['герб'] ? 1 : 0) && !big, imgs ? `в файле изображений: ${imgs}` : '');

  // 3. Незаполненные метки и служебные слова
  const left = all.match(/\{[#/^]?[а-яёa-z_0-9.]*\}|undefined|\[object/gi);
  add('Все метки шаблона заполнены', !left, left ? 'осталось: ' + [...new Set(left)].join(' ') : '');

  // 4. Сначала инициалы, потом фамилия
  const wrong = all.match(/(?<![\p{L}.])[А-ЯЁ][а-яё]+\s[А-ЯЁ]\.\s?[А-ЯЁ]\.(?![а-яё])/gu);
  add('Везде сначала инициалы, потом фамилия', !wrong, wrong ? 'найдено: ' + wrong.slice(0, 3).join('; ') : '');

  if(kind === 'report'){
    add('Рапорт адресован: ' + data['адресат'].join(' '), seq(data['адресат']) >= 0, 'строки адресата не найдены подряд');
    add('Подпись исполнителя в три строки', seq([data['исп_должность_1'], data['исп_должность_2'], `${data['исп_звание']}\t${data['исп_имя']}`]) >= 0,
      'ожидались строки: должность / подразделение / звание и И.О. Фамилия');
    if(name === 'raport_snd' || name === 'mfo_raport') add(`Резолюция «В дело ${data['нд']} разрешаю»`, ps.includes(`В дело ${data['нд']} разрешаю`), 'строка резолюции не найдена');
  }
  if(kind === 'phone'){
    add('Подпись исполнителя в три строки', seq([data['исп_должность_1'], data['исп_должность_2'], `${data['исп_звание']}\t${data['исп_имя']}`]) >= 0, 'строки подписи не найдены');
  }
  if(letter){
    const sLines = [...data['подписант_строки'], `${data['подписант_последняя']}\t${data['подписант_имя']}`];
    const at = seq(sLines);
    add('Уведомление подписывает: ' + sLines.join(' ').replace(/\t/g, ' '), at >= 0, 'строки подписанта не найдены');
    add('Между текстом и подписью 2 пустые строки', at >= 3 && ps[at - 1] === '' && ps[at - 2] === '' && ps[at - 3] !== '', 'перед подписью должно быть ровно две пустые строки');
    const ci = ps.indexOf(data['город']);
    add('Индекс заявителя — под адресом, после строки с городом', ci > 0 && /^\d{6}$/.test(data['индекс']) && ps[ci + 1] === data['индекс'] && ps[ci - 1] === data['адрес'],
      /^\d{6}$/.test(data['индекс']) ? 'строка индекса стоит не после города' : 'индекс не указан');
    add('Индекс подобран под улицу и дом, а не общий 655017', /^\d{6}$/.test(data['индекс']) && (data['индекс'] !== '655017' || (c && c.zipSrc === 'manual')),
      'стоит общий индекс 655017 — проверьте и подтвердите его в форме');
    add('Индекс в шапке МВД не изменён', ps.some(x => /Щетинкина, 6, Абакан, 655017/.test(x)) || !/Щетинкина/.test(all), 'в шапке изменён адрес или индекс');
    add('Сноска «Далее – Инструкция»', /Далее\s[–-]\s«?Инструкци/.test(xmlText(parts.footnotes.replace(/<[^>]+>/g, ''))), 'сноска не найдена');
  }
  if(kind === 'notice'){
    const tail = [data['кусп'], 'Отп. 2 экз:', '1 – в адрес;', '2 – в дело.'];
    add('Внизу блок: КУСП № … / Отп. 2 экз: / 1 – в адрес; / 2 – в дело.', seq(tail) === ps.length - tail.length, 'блок должен быть последним в документе, над сноской');
  }
  if(kind === 'notice-mfo'){
    const at = seq([`${data['подписант_последняя']}\t${data['подписант_имя']}`]);
    const after = at >= 0 ? ps.slice(at + 1).filter(Boolean) : ['?'];
    add('Микрофинансы: под подписью только строка КУСП, без «Исп.» и телефона', after.length === 1 && after[0] === data['кусп'], 'под подписью: ' + after.join(' / '));
  }
  return R;
}

// --- Пакет одним файлом ------------------------------------------------------------
// Тело каждого документа становится отдельным разделом (свои поля страницы сохраняются).
// За основу берётся документ со сносками; картинки и сноски остальных переносятся с новыми номерами.
function mergeDocx(list){
  if(list.length === 1) return list[0];
  const SECT = /<w:sectPr(?:\s[^>]*)?>(?:(?!<w:sectPr)[\s\S])*<\/w:sectPr>\s*$|<w:sectPr(?:\s[^>]*)?\/>\s*$/;
  const docs = list.map(bytes => {
    const zip = new PizZip(bytes), xml = zip.file('word/document.xml').asText();
    const m = /<w:body>([\s\S]*)<\/w:body>/.exec(xml), sm = SECT.exec(m[1]);
    return { zip, xml, inner: sm ? m[1].slice(0, sm.index) : m[1], sect: sm ? sm[0].trim() : '<w:sectPr/>',
      rels: (zip.file('word/_rels/document.xml.rels') || { asText: () => '' }).asText(), fn: zip.file('word/footnotes.xml') ? zip.file('word/footnotes.xml').asText() : '' };
  });
  let bi = docs.findIndex(d => d.fn && /<w:footnoteReference/.test(d.inner)); if(bi < 0) bi = 0;
  const base = docs[bi];
  let rels = base.rels, fn = base.fn, types = base.zip.file('[Content_Types].xml').asText(), n = 0;
  let fnMax = Math.max(1, ...[...fn.matchAll(/<w:footnote\s[^>]*w:id="(-?\d+)"/g)].map(m => +m[1]));
  docs.forEach((d, i) => {
    if(i === bi) return;
    // Связи (картинки, ссылки) — с новыми идентификаторами
    d.inner = d.inner.replace(/r:(embed|id|link)="([^"]+)"/g, (all, attr, id) => {
      const rel = new RegExp(`<Relationship\\s[^>]*Id="${escRe(id)}"[^>]*/>`).exec(d.rels);
      if(!rel) return all;
      const nid = 'rIdX' + (++n);
      let tag = rel[0].replace(/Id="[^"]+"/, `Id="${nid}"`);
      const target = /Target="([^"]+)"/.exec(tag)[1];
      if(!/TargetMode="External"/.test(tag) && /^media\//.test(target)){
        const f = d.zip.file('word/' + target), ext = target.split('.').pop().toLowerCase();
        const nt = `media/x${n}_${target.split('/').pop()}`;
        if(f) base.zip.file('word/' + nt, f.asUint8Array());
        tag = tag.replace(/Target="[^"]+"/, `Target="${nt}"`);
        if(!new RegExp(`Extension="${ext}"`, 'i').test(types))
          types = types.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext === 'jpg' ? 'jpeg' : ext}"/></Types>`);
      }
      rels = rels.replace('</Relationships>', tag + '</Relationships>');
      return `r:${attr}="${nid}"`;
    });
    // Сноски — с новыми номерами (только если у основы есть файл сносок)
    if(d.fn && fn){
      d.inner = d.inner.replace(/<w:footnoteReference w:id="(\d+)"\/>/g, (all, id) => {
        const m = new RegExp(`<w:footnote\\s(?:(?!w:type)[^>])*w:id="${id}"[^>]*>[\\s\\S]*?</w:footnote>`).exec(d.fn);
        if(!m) return '';
        const nid = ++fnMax;
        fn = fn.replace('</w:footnotes>', m[0].replace(/w:id="\d+"/, `w:id="${nid}"`) + '</w:footnotes>');
        return `<w:footnoteReference w:id="${nid}"/>`;
      });
    } else d.inner = d.inner.replace(/<w:footnoteReference[^>]*\/>/g, '');
    d.sect = d.sect.replace(/<w:(?:header|footer)Reference[^>]*\/>/g, '');
  });
  const body = docs.map((d, i) => d.inner + (i < docs.length - 1 ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${d.sect}</w:pPr></w:p>` : d.sect)).join('');
  // Пространства имён остальных документов добавляем в корень основы
  let root = /<w:document[^>]*>/.exec(base.xml)[0];
  docs.forEach(d => { for(const m of /<w:document[^>]*>/.exec(d.xml)[0].matchAll(/\sxmlns:[\w]+="[^"]+"/g)) if(!root.includes(m[0].trim().split('=')[0] + '=')) root = root.replace(/>$/, m[0] + '>'); });
  base.zip.file('word/document.xml', base.xml.replace(/<w:document[^>]*>/, root).replace(/<w:body>[\s\S]*<\/w:body>/, () => `<w:body>${body}</w:body>`));
  base.zip.file('word/_rels/document.xml.rels', rels);
  base.zip.file('[Content_Types].xml', types);
  if(fn) base.zip.file('word/footnotes.xml', fn);
  return base.zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}

// Собрать пакет: каждый документ, проверка каждого, общий файл
async function buildPack(c, cfg){
  const data = buildData(c, cfg), names = packDocs(c), out = [];
  for(const name of names){
    const bytes = await renderDoc(name, data);
    out.push({ name, title: DOCS[name].title, bytes, checks: checkDocx(bytes, name, data, c) });
  }
  const who = (c.pack === 'mfo' ? c.org : c.f) || 'материал';
  const base = `КУСП ${c.kusp || 'без номера'} ${who}`.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  out.forEach(d => { d.fileName = `${DOCS[d.name].file} — ${base}.docx`; });
  return { docs: out, merged: mergeDocx(out.map(d => d.bytes)), mergedName: `${c.pack === 'mfo' ? 'Микрофинансы' : 'СНД'} — ${base}.docx`, data };
}
