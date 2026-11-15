// Генератор стартовых шаблонов DOCX с плейсхолдерами {тег}.
// Запуск (только для разработки, приложению не нужен): node tools/make-templates.mjs
// Оформление — как в образцах: поля 30/10/20/20 мм, PT Astra Serif, уведомление 12,5 пт,
// рапорты 14 пт. Свой шаблон можно загрузить в приложении: «Настройки → Шаблоны».
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'templates');
const FONT = 'PT Astra Serif';
const PAGE = { w: 11906, h: 16838 };
const M = { top: 1134, right: 567, bottom: 1134, left: 1701 };   // 20 / 10 / 20 / 30 мм
const WIDTH = PAGE.w - M.left - M.right;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const P = (text, o = {}) => ({ t: 'p', runs: [{ text: text ?? '' }], ...o });
const PT = (left, right, o = {}) => ({ t: 'p', runs: [{ text: left }, { tab: true }, { text: right }], tabRight: true, ...o });
const body = (text, size = 14) => P(text, { jc: 'both', firstLine: 709, size });
const rfonts = `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/>`;

function docx(blocks, { footnote, emblem } = {}){
  let usedEmblem = false;
  const run = (r, o) => {
    const size = Math.round((o.size || 14) * 2);
    const rpr = `<w:rPr>${rfonts}${o.b ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
    if(r.tab) return '<w:r><w:tab/></w:r>';
    if(r.fn) return `<w:r>${rpr}<w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="2"/></w:r>`;
    return `<w:r>${rpr}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
  };
  const para = (b, width) => {
    const size = Math.round((b.size || 14) * 2);
    return '<w:p><w:pPr>' +
      (b.tabRight ? `<w:tabs><w:tab w:val="right" w:pos="${width}"/></w:tabs>` : '') +
      `<w:spacing w:before="${b.before || 0}" w:after="${b.after || 0}" w:line="240" w:lineRule="auto"/>` +
      (b.firstLine ? `<w:ind w:firstLine="${b.firstLine}"/>` : '') +
      `<w:jc w:val="${b.jc || 'left'}"/><w:rPr>${rfonts}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>` +
      b.runs.map(r => run(r, b)).join('') + '</w:p>';
  };
  const image = b => {
    usedEmblem = true;
    const cx = Math.round(b.wPt * 12700), cy = Math.round(b.hPt * 12700);
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
      `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Герб"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="emblem"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdM1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  };
  const table = b => {
    const total = b.cols.reduce((a, x) => a + x, 0);
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="nil"/>`).join('');
    const rows = b.rows.map(row => '<w:tr>' + row.map((cell, i) =>
      `<w:tc><w:tcPr><w:tcW w:w="${b.cols[i]}" w:type="dxa"/></w:tcPr>${render(cell, b.cols[i]) || '<w:p/>'}</w:tc>`).join('') + '</w:tr>').join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders>` +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblGrid>${b.cols.map(x => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
  };
  const render = (list, width) => list.map(b => b.t === 'p' ? para(b, width) : b.t === 'img' ? image(b) : b.t === 'table' ? table(b) : '').join('');

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const document = `${head}<w:document ${NS}><w:body>${render(blocks, WIDTH)}` +
    `<w:sectPr><w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}"/><w:pgMar w:top="${M.top}" w:right="${M.right}" w:bottom="${M.bottom}" w:left="${M.left}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `${head}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${rfonts}` +
    '<w:sz w:val="28"/><w:szCs w:val="28"/><w:lang w:val="ru-RU" w:eastAsia="ru-RU" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';
  const settings = `${head}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/>` +
    (footnote ? '<w:footnotePr><w:footnote w:id="0"/><w:footnote w:id="1"/></w:footnotePr>' : '') +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
  // Сноска: служебные 0 и 1 (разделители) и сама сноска с номером 2
  const fnRun = t => `<w:r><w:rPr>${rfonts}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const footnotes = `${head}<w:footnotes ${NS}>` +
    '<w:footnote w:type="separator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    `<w:footnote w:id="2"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>` +
    `<w:r><w:rPr>${rfonts}<w:sz w:val="20"/><w:szCs w:val="20"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>${fnRun(' ' + (footnote || ''))}</w:p></w:footnote></w:footnotes>`;
  const types = `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    (footnote ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : '') +
    '</Types>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rootRels = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdS1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdS2" Type="${REL}/settings" Target="settings.xml"/>` +
    (footnote ? `<Relationship Id="rIdF1" Type="${REL}/footnotes" Target="footnotes.xml"/>` : '') +
    (usedEmblem ? `<Relationship Id="rIdM1" Type="${REL}/image" Target="media/emblem.png"/>` : '') + '</Relationships>';
  const files = [
    ['[Content_Types].xml', types], ['_rels/.rels', rootRels], ['word/document.xml', document], ['word/styles.xml', styles],
    ['word/settings.xml', settings], ['word/_rels/document.xml.rels', docRels]
  ];
  if(footnote) files.push(['word/footnotes.xml', footnotes]);
  if(usedEmblem) files.push(['word/media/emblem.png', emblem]);
  return zip(files);
}

// Zip со сжатием deflate — без сторонних библиотек
function zip(files){
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xFFFFFFFF; for(const x of b) c = crcT[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = [], central = []; let offset = 0;
  for(const [name, content] of files){
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const data = zlib.deflateRawSync(raw), n = Buffer.from(name, 'utf8'), sum = crc(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x5821, 12);
    h.writeUInt32LE(sum, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5821, 14);
    c.writeUInt32LE(sum, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, n, data); central.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, e]);
}

// ---------------------------------------------------------------------------------
// Общие куски
const KUSP = '{кусп}';
const letterhead = right => ({ t: 'table', cols: [4600, 700, 4338], rows: [[[
  P('{#герб}', { size: 2 }), { t: 'img', wPt: 99, hPt: 51.4 }, P('{/герб}', { size: 2 }),
  P('МВД по Республике Хакасия', { jc: 'center', size: 12, b: true }),
  P('Управление Министерства внутренних дел Российской Федерации', { jc: 'center', size: 12, b: true }),
  P('по городу Абакану', { jc: 'center', size: 12, b: true }),
  P('(УМВД России по г. Абакану)', { jc: 'center', size: 12, b: true }),
  P('', { size: 6 }),
  P('ул. Щетинкина, 6, Абакан, 655017', { jc: 'center', size: 12 }),
  P('тел. (3902) 23-66-20', { jc: 'center', size: 12 }),
  P('', { size: 8 }),
  P('______________ № ______________', { jc: 'center', size: 12 }),
  P('на № ____________ от ____________', { jc: 'center', size: 12 })
], [P('')], right]] });
const loop = (tag, inner, o = {}) => [P(`{#${tag}}`, o), P(inner, o), P(`{/${tag}}`, o)];
const chief = () => loop('адресат', '{.}');
const sign = () => [P('{исп_должность_1}'), P('{исп_должность_2}'), PT('{исп_звание}', '{исп_имя}'), P('{дата_документа}')];
const signer = () => [...loop('подписант_строки', '{.}', { size: 13 }), PT('{подписант_последняя}', '{подписант_имя}', { size: 13 })];
const resolution = () => ({ t: 'table', cols: [4600, 5038], rows: [[
  [P('В соответствии с пунктом 63', { size: 12 }), P('Приказа МВД России от 29.08.2014 № 736', { size: 12 }),
   P('В дело {нд} разрешаю', { size: 12 }), P('«____» ____________ {год} г.', { size: 12 })], chief()]] });
const INSTR = 'Инструкции о порядке приема, регистрации и разрешения в территориальных органах Министерства внутренних дел Российской Федерации заявлений и сообщений о преступлениях, об административных правонарушениях, о происшествиях, утверждённой приказом МВД России от 29.08.2014 № 736';
const decision = (size = 12.5) => ({ t: 'p', jc: 'both', firstLine: 709, size, runs: [
  { text: `По результатам проверки на основании п. 63.3 ${INSTR}` }, { fn: true },
  { text: ', принято решение о приобщении материалов в специальное номенклатурное дело № {нд} в связи с отсутствием признаков преступления или административного правонарушения. В ходе проверки установлено, что {установлено}' }] });

const T = {};

// 1. Уведомление заявителю
T['uvedomlenie'] = [[
  letterhead([P('', { size: 13 }), P('', { size: 13 }), P('', { size: 13 }), P('{заявитель_дат}', { size: 13 }), P('', { size: 13 }),
    P('{адрес}', { size: 13 }), P('{город}', { size: 13 }), P('{индекс}', { size: 13 })]),
  P(''),
  P('{уважаемый} {имя_отчество}!', { jc: 'center', size: 12.5 }),
  P('', { size: 12.5 }),
  body(`Настоящим уведомляю, что Ваше обращение зарегистрировано в Книге учета заявлений и сообщений о преступлениях, об административных правонарушениях, о происшествиях (${KUSP}).`, 12.5),
  decision(),
  ...loop('права', '{.}', { jc: 'both', firstLine: 709, size: 12.5 }),
  body('Кроме того, найти информацию об участковом уполномоченном полиции, в территорию обслуживания которого входит Ваш адрес проживания, Вы можете на официальном сайте МВД по Республике Хакасия в разделе «Ваш участковый/Отдел полиции»: https://xn--b1aew.xn--p1ai/district.', 12.5),
  P('', { size: 12.5 }), P('', { size: 12.5 }),
  ...signer(),
  P('', { size: 10 }),
  P('Исп. {исп_имя}', { size: 10 }),
  ...loop('исп_телефон', 'тел. {исп_телефон}', { size: 10 }),
  ...loop('исп_почта', '{исп_почта}', { size: 10 }),
  P(KUSP, { size: 10 }), P('Отп. 2 экз:', { size: 10 }), P('1 – в адрес;', { size: 10 }), P('2 – в дело.', { size: 10 })
], { footnote: 'Далее – «Инструкция».' }];

// 2. Рапорт на списание в номенклатурное дело
T['raport_snd'] = [[
  resolution(),
  P(''), P('РАПОРТ', { jc: 'center', after: 240 }),
  body(`Докладываю, что {дата_сообщения} в {час} час. {мин} мин. в ДЧ {орган} поступило сообщение гр. {заявитель_род} (${KUSP}) о том, что {фабула}`),
  body('В ходе проверки{#по_телефону} по телефону{/по_телефону} {опрошен} заявитель {заявитель_им}, {дата_рождения} года рождения, {проживающий} по адресу: {город}, {адрес}, {который} {пояснил}, что {пояснения}'),
  body('{нет_сведений}'),
  body('{вывод}'),
  body(`В связи с тем, что в материале проверки ${KUSP}, поступившем в {орган}, информации о преступлении, об административном правонарушении, о происшествии не содержится, прошу Вашего разрешения на приобщение сообщения к номенклатурному делу № {нд}.`),
  P(''), ...sign()
]];

// 3. Рапорт по результатам проверки
T['raport_proverka'] = [[
  { t: 'table', cols: [5100, 4538], rows: [[[P('')], chief()]] },
  P(''), P(''), P('РАПОРТ', { jc: 'center', after: 240 }),
  body('Докладываю, что {дата_сообщения} в {час} час. {мин} мин. в ДЧ {орган} поступило сообщение гр. {заявитель_род} о том, что {фабула}'),
  body('В ходе проверки установлено, что {установлено}'),
  body('{#по_телефону}По данному факту пояснения {заявитель_род} получены по телефону и оформлены телефонограммой. Противоправных действий не установлено.{/по_телефону}{^по_телефону}По данному факту от {заявитель_род} получено письменное объяснение. Противоправных действий в отношении {него} не совершалось.{/по_телефону}'),
  P(''), P(''), ...sign()
]];

// 4. Рапорт о приобщении одного КУСП к другому
T['raport_priobshenie'] = [[
  { t: 'table', cols: [5100, 4538], rows: [[[P('')], chief()]] },
  P(''), P(''), P('РАПОРТ', { jc: 'center', after: 240 }),
  body(`Докладываю, что в моём производстве находится материал проверки ${KUSP} по сообщению гр. {заявитель_род} о том, что {фабула}`),
  body('В ходе проверки установлено, что по данному факту ранее зарегистрирован материал проверки {кусп2}.'),
  body(`В связи с тем, что указанные материалы зарегистрированы по одному и тому же факту, в соответствии с пунктом 48 Инструкции, утверждённой приказом МВД России от 29.08.2014 № 736, прошу Вашего разрешения на приобщение материала проверки ${KUSP} к материалу проверки {кусп2}.`),
  P(''), P(''), ...sign()
]];

// 5. Телефонограмма
T['telefonogramma'] = [[
  P('ТЕЛЕФОНОГРАММА', { jc: 'center' }), P(''),
  body('{дата_документа} {исп_твор} по телефону {телефон} принята телефонограмма от {заявитель_род_полн}, {дата_рождения} года рождения, {проживающего} по адресу: {город}, {адрес}.'),
  body(`По материалу проверки ${KUSP} {заявитель_кратко} {пояснил}, что {пояснения}`),
  body('Прибыть для дачи письменного объяснения {заявитель_кратко} не может. Свои пояснения {готов} подтвердить по телефону либо посредством СМС-сообщения.'),
  P(''), P('Телефонограмму принял:'), ...sign()
]];

// 6. Микрофинансы: рапорт (невозврат займа, ст. 159.1 УК РФ)
T['mfo_raport'] = [[
  resolution(),
  P(''), P('РАПОРТ', { jc: 'center', after: 240 }),
  body(`Докладываю, что {дата_сообщения} в ДЧ {орган} поступило заявление {организация_род}{#представитель_род} в лице представителя {представитель_род}{/представитель_род} (${KUSP}) о том, что {фабула}`),
  body('В ходе проверки установлено, что {установлено}'),
  body('Таким образом, между сторонами сложились гражданско-правовые отношения, вытекающие из договора займа; признаков преступления, предусмотренного ст. 159.1 УК РФ, не усматривается. Спор о взыскании задолженности подлежит разрешению в порядке гражданского судопроизводства.'),
  body(`В связи с тем, что в материале проверки ${KUSP}, поступившем в {орган}, информации о преступлении, об административном правонарушении, о происшествии не содержится, прошу Вашего разрешения на приобщение сообщения к номенклатурному делу № {нд}.`),
  P(''), ...sign()
]];

// 7. Микрофинансы: уведомление — без «Исп.» и телефона, внизу только строка КУСП
T['mfo_uvedomlenie'] = [[
  letterhead([P('', { size: 13 }), P('', { size: 13 }), P('', { size: 13 }), P('{организация}', { size: 13 }), P('', { size: 13 }),
    P('{адрес}', { size: 13 }), P('{город}', { size: 13 }), P('{индекс}', { size: 13 })]),
  P(''),
  P('{обращение}', { jc: 'center', size: 12.5 }),
  P('', { size: 12.5 }),
  body(`Настоящим уведомляю, что Ваше обращение зарегистрировано в Книге учета заявлений и сообщений о преступлениях, об административных правонарушениях, о происшествиях (${KUSP}).`, 12.5),
  decision(),
  body('Разъясняю, что для взыскания задолженности по договору займа Вы вправе обратиться в суд в порядке гражданского судопроизводства (ст. 11, 12 ГК РФ). Принятое решение Вы вправе обжаловать начальнику {орган_род}, в прокуратуру г. Абакана либо в суд.', 12.5),
  P('', { size: 12.5 }), P('', { size: 12.5 }),
  ...signer(),
  P('', { size: 10 }),
  P(KUSP, { size: 10 })
], { footnote: 'Далее – «Инструкция».' }];

const emblem = fs.readFileSync(path.join(HERE, 'emblem.png'));
fs.mkdirSync(OUT, { recursive: true });
for(const [name, [blocks, opt]] of Object.entries(T)){
  fs.writeFileSync(path.join(OUT, name + '.docx'), docx(blocks, { ...opt, emblem }));
  console.log('шаблон', name + '.docx');
}
