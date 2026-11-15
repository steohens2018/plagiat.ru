// Прокси для нейросети (Cloudflare Worker). Нужен, чтобы ключ хранился на сервере,
// а не в телефоне: приложение шлёт запрос сюда, воркер добавляет ключ и пересылает дальше.
//
// Воркер ничего не хранит и не пишет в журнал: тело запроса и ответ только пересылаются.
// Не добавляйте сюда console.log с телом запроса и не включайте Workers Logs для этого воркера.
//
// Переменные (Settings → Variables and Secrets):
//   API_KEY        (Secret, обязательно) — ключ сервиса нейросети
//   UPSTREAM_URL   (необязательно) — адрес сервиса; по умолчанию Mistral
//   MODEL          (необязательно) — модель, если приложение её не прислало
//   ALLOWED_ORIGIN (обязательно) — адрес вашего приложения, например https://snd-abakan.netlify.app
//                  (несколько — через запятую). С других сайтов запросы не принимаются.
//   ACCESS_CODE    (Secret, желательно) — код доступа; тот же код вводится в настройках приложения.
//                  Без него прокси сможет пользоваться любой, кто узнает адрес.

const DEFAULT_UPSTREAM = 'https://api.mistral.ai/v1/chat/completions';
const DEFAULT_MODEL = 'mistral-small-latest';
const MAX_BODY = 8 * 1024 * 1024;            // 8 МБ: текст и до нескольких сжатых фото

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    };
    const reply = (status, message) => new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, 'Только POST');
    if (!allowed.length) return reply(500, 'На сервере не задан ALLOWED_ORIGIN');
    if (!allowed.includes(origin)) return reply(403, 'Запрос с этого сайта не разрешён');
    if (!env.API_KEY) return reply(500, 'На сервере не задан API_KEY');
    if (env.ACCESS_CODE && !safeEqual(request.headers.get('X-Access-Code') || '', env.ACCESS_CODE)) return reply(401, 'Неверный код доступа');
    if (+request.headers.get('Content-Length') > MAX_BODY) return reply(413, 'Запрос слишком большой');

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return reply(413, 'Запрос слишком большой');
      body = JSON.parse(raw);
    } catch (e) { return reply(400, 'Тело запроса — не JSON'); }
    if (!Array.isArray(body.messages) || !body.messages.length) return reply(400, 'Нет поля messages');

    // Пересылаем только нужные поля: приложение не может заставить воркер вызвать что-то ещё
    const out = { model: body.model || env.MODEL || DEFAULT_MODEL, messages: body.messages, temperature: typeof body.temperature === 'number' ? body.temperature : 0.1, max_tokens: 2000 };
    if (body.response_format && body.response_format.type === 'json_object') out.response_format = { type: 'json_object' };

    let upstream;
    try {
      upstream = await fetch(env.UPSTREAM_URL || DEFAULT_UPSTREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.API_KEY },
        body: JSON.stringify(out)
      });
    } catch (e) { return reply(502, 'Сервис нейросети недоступен'); }
    // Ответ отдаём как есть — вместе с кодом ошибки, чтобы приложение показало причину
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' } });
  }
};

// Сравнение без утечки по времени
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
