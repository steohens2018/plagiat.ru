// Склонение ФИО и званий: родительный, дательный, творительный падежи.
// Правила для типичных русских фамилий, имён и отчеств; результат всегда виден
// в форме и в готовом документе, его можно поправить.
'use strict';

const HUSH = /[гкхжшщч]$/i;   // после них «ы» → «и»: Ольга → Ольги
const replEnd = (w, n, add) => w.slice(0, w.length - n) + add;

function declineSurname(w, sex, cs){
  if(!w) return '';
  const parts = w.split('-');
  if(parts.length > 1) return parts.map(p => declineSurname(p, sex, cs)).join('-');
  const l = w.toLowerCase(), g = cs === 'gen';
  if(/(о|е|э|и|у|ю|ых|их)$/.test(l)) return w;                          // несклоняемые
  if(sex === 'f'){
    if(/(ова|ева|ёва|ина|ына)$/.test(l)) return replEnd(w, 1, 'ой');
    if(/ая$/.test(l)) return replEnd(w, 2, 'ой');
    if(/яя$/.test(l)) return replEnd(w, 2, 'ей');
    if(/ия$/.test(l)) return replEnd(w, 1, 'и');
    if(/а$/.test(l)) return replEnd(w, 1, g ? (HUSH.test(l.slice(0, -1)) ? 'и' : 'ы') : 'е');
    if(/я$/.test(l)) return replEnd(w, 1, g ? 'и' : 'е');
    return w;                                                           // женские на согласный не склоняются
  }
  if(/(ский|цкий|ой|ый|ий)$/.test(l)) return replEnd(w, 2, g ? 'ого' : 'ому');
  if(/ия$/.test(l)) return replEnd(w, 1, 'и');
  if(/а$/.test(l)) return replEnd(w, 1, g ? (HUSH.test(l.slice(0, -1)) ? 'и' : 'ы') : 'е');
  if(/я$/.test(l)) return replEnd(w, 1, g ? 'и' : 'е');
  if(/[ьй]$/.test(l)) return replEnd(w, 1, g ? 'я' : 'ю');
  if(/[бвгджзклмнпрстфхцчшщ]$/.test(l)) return w + (g ? 'а' : 'у');
  return w;
}
function declineName(w, sex, cs){
  if(!w) return '';
  const l = w.toLowerCase(), g = cs === 'gen';
  if(/ия$/.test(l)) return replEnd(w, 1, 'и');
  if(/а$/.test(l)) return replEnd(w, 1, g ? (HUSH.test(l.slice(0, -1)) ? 'и' : 'ы') : 'е');
  if(/я$/.test(l)) return replEnd(w, 1, g ? 'и' : 'е');
  if(sex === 'f'){
    if(/овь$/.test(l)) return replEnd(w, 3, 'ови');
    if(/ь$/.test(l)) return replEnd(w, 1, 'и');
    return w;
  }
  if(/[ьй]$/.test(l)) return replEnd(w, 1, g ? 'я' : 'ю');
  if(/[бвгджзклмнпрстфхцчшщ]$/.test(l)) return w + (g ? 'а' : 'у');
  return w;
}
function declinePatronymic(w, cs){
  if(!w) return '';
  const l = w.toLowerCase(), g = cs === 'gen';
  if(/ич$/.test(l)) return w + (g ? 'а' : 'у');
  if(/на$/.test(l)) return replEnd(w, 1, g ? 'ы' : 'е');
  return w;
}
// Фамилия в творительном падеже: «Созыкиным», «Ивановой»
function surnameIns(sur, sex){
  const l = (sur || '').toLowerCase();
  if(sex === 'f'){
    if(/(ова|ева|ёва|ина|ына)$/.test(l)) return sur.slice(0, -1) + 'ой';
    if(/ая$/.test(l)) return sur.slice(0, -2) + 'ой';
    if(/а$/.test(l)) return sur.slice(0, -1) + (/[жшщчц]$/.test(l.slice(0, -1)) ? 'ей' : 'ой');
    return sur;
  }
  if(/(ов|ев|ёв|ин|ын)$/.test(l)) return sur + 'ым';
  if(/(ский|цкий)$/.test(l)) return sur.slice(0, -2) + 'им';
  if(/(ой|ый)$/.test(l)) return sur.slice(0, -2) + 'ым';
  if(/[бвгджзклмнпрстфхцчшщ]$/.test(l)) return sur + 'ом';
  if(/[ьй]$/.test(l)) return sur.slice(0, -1) + 'ем';
  if(/а$/.test(l)) return sur.slice(0, -1) + 'ой';
  return sur;
}
// Звание в нужном падеже: «лейтенант полиции» → «лейтенантом полиции»
function rankCase(rank, cs){
  const end = { gen: 'а', dat: 'у', ins: 'ом' }[cs];
  if(!end || !rank) return rank || '';
  return rank.split(' ').map(w => {
    const l = w.toLowerCase();
    if(/^(мл\.|ст\.)$/.test(l)) return w;
    if(/^(младший|старший)$/.test(l)) return w.slice(0, -2) + { gen: 'его', dat: 'ему', ins: 'им' }[cs];
    if(/^(лейтенант|капитан|майор|подполковник|полковник|генерал|сержант|прапорщик|старшина)$/.test(l)) return w + end;
    return w;
  }).join(' ');
}

// ФИО в родительном или дательном падеже → именительный. Падеж и пол видны по отчеству;
// для каждого слова подбирается форма, которая при склонении даёт исходное слово.
function toNominative(f, i, o){
  const low = (o || '').toLowerCase();
  let sex = '', cs = '';
  if(/(вны|чны)$/.test(low)){ sex = 'f'; cs = 'gen'; }
  else if(/(вне|чне)$/.test(low)){ sex = 'f'; cs = 'dat'; }
  else if(/ича$/.test(low)){ sex = 'm'; cs = 'gen'; }
  else if(/ичу$/.test(low)){ sex = 'm'; cs = 'dat'; }
  else return [f, i, o];
  const ENDS = ['', 'а', 'я', 'ий', 'ый', 'ая', 'ия', 'ья', 'й', 'ь', 'ой'];
  const VOWEL = /[аеёиоуыэюя]$/i;
  const back = (w, fn) => {
    if(!w) return w;
    let best = w, rank = 99;
    for(let cut = 1; cut <= 3 && cut < w.length - 1; cut++){
      const stem = w.slice(0, -cut);
      ENDS.forEach((e, r) => {
        const cand = stem + e;
        if(r >= rank || cand.toLowerCase() === w.toLowerCase()) return;
        if((e === 'й' && !VOWEL.test(stem)) || (e === 'ь' && VOWEL.test(stem))) return;
        if(fn(cand).toLowerCase() === w.toLowerCase()){ best = cand; rank = r; }
      });
    }
    return best;
  };
  return [back(f, x => declineSurname(x, sex, cs)), back(i, x => declineName(x, sex, cs)), back(o, x => declinePatronymic(x, cs))];
}

function sexOf(c){
  if(c.sex === 'm' || c.sex === 'f') return c.sex;
  const o = (c.o || '').toLowerCase();
  if(/(вна|чна|кызы)$/.test(o)) return 'f';
  if(/(ич|оглы)$/.test(o)) return 'm';
  const i = (c.i || '').toLowerCase();
  return /[ая]$/.test(i) && !/^(илья|никита|кузьма|фома|лука|савва)$/.test(i) ? 'f' : 'm';
}
const initials = (i, o) => [i, o].filter(Boolean).map(x => x.trim()[0].toUpperCase() + '.').join('');

// Все формы имени заявителя. Короткие формы — «И.О. Фамилия»: сначала инициалы, потом фамилия.
function person(c){
  const sex = sexOf(c), ini = initials(c.i, c.o);
  const f = (c.f || '').trim(), i = (c.i || '').trim(), o = (c.o || '').trim();
  const fem = sex === 'f';
  const short = sur => [ini, sur].filter(Boolean).join(' ');
  return {
    sex, has: !!f,
    full: [f, i, o].filter(Boolean).join(' '),
    short: short(f),
    gen: short(declineSurname(f, sex, 'gen')),
    dat: short(declineSurname(f, sex, 'dat')),
    genFull: [declineSurname(f, sex, 'gen'), declineName(i, sex, 'gen'), declinePatronymic(o, 'gen')].filter(Boolean).join(' '),
    io: [i, o].filter(Boolean).join(' '),
    w: {
      dear: fem ? 'Уважаемая' : 'Уважаемый', questioned: fem ? 'опрошена' : 'опрошен', who: fem ? 'которая' : 'который',
      explained: fem ? 'пояснила' : 'пояснил', living: fem ? 'проживающая' : 'проживающий', livingGen: fem ? 'проживающей' : 'проживающего',
      him: fem ? 'неё' : 'него', ready: fem ? 'готова' : 'готов'
    }
  };
}

// «Иванов И.И.» в тексте → «И.И. Иванов»: правило «сначала инициалы, потом фамилия»
function initialsFirst(text){
  return String(text || '').replace(/(?<![\p{L}.])([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s+([А-ЯЁ]\.)\s?([А-ЯЁ]\.)(?![а-яё])/gu, '$2$3 $1');
}
