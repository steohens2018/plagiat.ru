// Самопроверка на выдуманных данных: маскировка (что ушло бы наружу) и сборка тестового пакета
// с проверкой правил оформления. Запускается из настроек и из tools/selftest.mjs.
'use strict';

function selftestCase(pack = 'snd'){
  const c = newCase();
  Object.assign(c, {
    pack, f: 'Кузнецова', i: 'Марина', o: 'Викторовна', birth: '1984-03-12', phone: '8-913-555-12-34',
    city: 'г. Абакан', street: 'ул. Пушкина', house: '120', flat: '45', zip: '655004', zipSrc: 'manual',
    kusp: '28451', kuspDate: '2026-10-15', msgDate: '2026-10-15', msgTime: '18:40', docDate: '2026-10-20',
    fabula: 'Её сосед Петренко О.Н. шумит по ночам и высказывает в её адрес угрозы',
    explain: 'конфликт с соседом носит бытовой характер, угроз убийством он не высказывал, претензий она не имеет',
    found: '', join: true, kusp2: '28120', kusp2Date: '2026-10-12', byPhone: true
  });
  if(pack === 'mfo') Object.assign(c, { org: 'ООО МКК «Быстрый заём»', f: 'Лебедева', i: 'Ольга', o: 'Сергеевна', street: 'ул. Торосова', house: '9', flat: '', zip: '655004',
    fabula: 'Гр. Тодышев А.М. заключил договор займа на сумму 15 000 рублей и не исполняет обязательства по его возврату', join: false, byPhone: false });
  return c;
}

async function runSelftest(){
  // 1. Маскировка: наружу уходит только текст с метками
  const mask = SELFTEST_CASES.map(t => {
    const m = createMasker(), out = m.mask(t.text);
    return { title: t.title, out, leaks: findLeaks(out, t.secrets), checked: t.secrets.length, table: m.table() };
  });
  // 2. Тестовые пакеты: СНД со всеми галочками и «Микрофинансы», со справочниками по умолчанию
  const cfg = defaultConfig(), docs = [];
  const a = await buildPack(selftestCase('snd'), cfg), b = await buildPack(selftestCase('mfo'), cfg);
  for(const d of [...a.docs, ...b.docs]) docs.push({ title: d.title, checks: d.checks });
  // 3. Общий файл: тот же набор правил шрифта и картинок должен соблюдаться и после склейки
  const parts = docxParts(a.merged), sections = (parts.document.match(/<w:sectPr/g) || []).length;
  const fonts = new Set([...(parts.document + parts.styles + parts.footnotes).matchAll(/<w:rFonts[^>]*w:ascii="([^"]*)"/g)].map(x => x[1]));
  docs.push({ title: 'Пакет одним файлом', checks: [
    { rule: `Все документы пакета в одном файле (разделов: ${sections})`, ok: sections === a.docs.length, note: `ожидалось ${a.docs.length}` },
    { rule: 'Шрифт PT Astra Serif во всём файле', ok: fonts.size === 1 && fonts.has(FONT_NAME), note: [...fonts].join(', ') },
    { rule: 'Сноска уведомления сохранена', ok: /<w:footnoteReference/.test(parts.document) && /Далее/.test(parts.footnotes), note: 'сноска потерялась' }
  ] });
  const ok = mask.every(m => !m.leaks.length) && docs.every(d => d.checks.every(x => x.ok));
  return { ok, mask, docs, merged: a.merged, mfo: b.merged, files: [...a.docs, ...b.docs] };
}
