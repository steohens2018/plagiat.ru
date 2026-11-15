// Локальное хранилище: IndexedDB, всё содержимое зашифровано AES-GCM.
// Ключ данных (случайный) завёрнут ключом из PIN-кода (PBKDF2-SHA-256, 600 000 итераций),
// поэтому смена PIN не требует перешифровывать материалы. Открытого хранения нет:
// без PIN-кода ничего не читается и не пишется.
'use strict';

const KDF_ITER = 600000;
const MAX_FAILS = 10;
const DB_NAME = 'snd-db';
const enc8 = new TextEncoder(), dec8 = new TextDecoder();

const Crypto = {
  async pinKey(pin, salt, iter = KDF_ITER){
    const base = await crypto.subtle.importKey('raw', enc8.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async seal(key, bytes){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) };
  },
  async open(key, box){ return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, key, box.ct)); },
  sealJson(key, obj){ return this.seal(key, enc8.encode(JSON.stringify(obj))); },
  async openJson(key, box){ return JSON.parse(dec8.decode(await this.open(key, box))); }
};

const Store = {
  db: null, key: null, cases: [], cfg: null, gen: 0,

  open(){
    if(this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore('meta');                                   // соль, завёрнутый ключ, счётчик ошибок
        db.createObjectStore('cases', { keyPath: 'id' });               // материалы: { id, iv, ct }
        const ph = db.createObjectStore('photos', { keyPath: 'id' });   // фото: { id, caseId, ts, iv, ct }
        ph.createIndex('caseId', 'caseId');
        db.createObjectStore('kv');                                     // настройки, шаблоны, индексы: { iv, ct }
      };
      rq.onsuccess = () => { this.db = rq.result; res(this.db); };
      rq.onerror = () => rej(new Error('Хранилище браузера недоступно (частный режим?)'));
    });
  },
  async tx(store, mode, fn){
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : out);
      t.onerror = t.onabort = () => rej(t.error || new Error('Ошибка хранилища'));
    });
  },
  meta(k){ return this.tx('meta', 'readonly', s => s.get(k)); },
  setMeta(k, v){ return this.tx('meta', 'readwrite', s => s.put(v, k)); },

  async state(){ return this.key ? 'open' : (await this.meta('wrap')) ? 'locked' : 'new'; },

  // Первый вход: PIN-код задаёт ключ, которым завёрнут случайный ключ данных
  async setup(pin){
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const dek = crypto.getRandomValues(new Uint8Array(32));
    const wrap = await Crypto.seal(await Crypto.pinKey(pin, salt), dek);
    await this.setMeta('wrap', { salt, iter: KDF_ITER, iv: wrap.iv, ct: wrap.ct });
    await this.setMeta('fails', 0);
    await this.adopt(dek);
  },
  async adopt(dek){
    this.key = await crypto.subtle.importKey('raw', dek, 'AES-GCM', false, ['encrypt', 'decrypt']);
    dek.fill(0);
    this.gen++;
    await this.loadAll();
  },
  // Вход. После MAX_FAILS неверных попыток подряд всё стирается.
  async unlock(pin){
    const w = await this.meta('wrap');
    if(!w) throw new Error('PIN-код ещё не задан');
    let dek;
    try { dek = await Crypto.open(await Crypto.pinKey(pin, w.salt, w.iter), w); }
    catch(e){
      const fails = ((await this.meta('fails')) || 0) + 1;
      if(fails >= MAX_FAILS){ await this.wipe(); throw new Error('Неверный PIN-код 10 раз подряд — данные стёрты'); }
      await this.setMeta('fails', fails);
      throw new Error(`Неверный PIN-код. Осталось попыток: ${MAX_FAILS - fails}`);
    }
    await this.setMeta('fails', 0);
    await this.adopt(dek);
  },
  async checkPin(pin){
    const w = await this.meta('wrap');
    try { (await Crypto.open(await Crypto.pinKey(pin, w.salt, w.iter), w)).fill(0); return true; } catch(e){ return false; }
  },
  async changePin(oldPin, newPin){
    const w = await this.meta('wrap'), gen = this.gen;
    let dek;
    try { dek = await Crypto.open(await Crypto.pinKey(oldPin, w.salt, w.iter), w); }
    catch(e){ throw new Error('Текущий PIN-код неверен'); }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrap = await Crypto.seal(await Crypto.pinKey(newPin, salt), dek);
    dek.fill(0);
    if(gen !== this.gen || !this.key) throw new Error('Приложение было заблокировано — PIN-код не изменён');
    await this.setMeta('wrap', { salt, iter: KDF_ITER, iv: wrap.iv, ct: wrap.ct });
  },
  lock(){ this.key = null; this.cases = []; this.cfg = null; this.gen++; },

  async loadAll(){
    const rows = await this.tx('cases', 'readonly', s => s.getAll());
    const out = [];
    for(const r of rows){ try { out.push(await Crypto.openJson(this.key, r)); } catch(e){ /* повреждённую запись пропускаем */ } }
    this.cases = out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    this.cfg = Object.assign(defaultConfig(), (await this.getKV('cfg')) || {});
  },
  needKey(){ if(!this.key) throw new Error('Приложение заблокировано'); return this.key; },

  async saveCase(c){
    const key = this.needKey();
    c.updated = Date.now();
    const box = await Crypto.sealJson(key, c);
    await this.tx('cases', 'readwrite', s => s.put({ id: c.id, iv: box.iv, ct: box.ct }));
    const i = this.cases.findIndex(x => x.id === c.id);
    if(i >= 0) this.cases.splice(i, 1);
    this.cases.unshift(c);
  },
  // «Удалить всё по этому КУСП»: материал, таблица меток внутри него и все его фото
  async deleteCase(id){
    const ids = await this.tx('photos', 'readonly', s => s.index('caseId').getAllKeys(id));
    await this.tx('photos', 'readwrite', s => { ids.forEach(k => s.delete(k)); });
    await this.tx('cases', 'readwrite', s => s.delete(id));
    this.cases = this.cases.filter(x => x.id !== id);
  },

  async putPhoto(caseId, blob, extra = {}){
    const key = this.needKey(), id = uid();
    const box = await Crypto.seal(key, new Uint8Array(await blob.arrayBuffer()));
    const info = await Crypto.sealJson(key, Object.assign({ type: blob.type || 'image/jpeg' }, extra));
    await this.tx('photos', 'readwrite', s => s.put({ id, caseId, ts: Date.now(), iv: box.iv, ct: box.ct, info }));
    return id;
  },
  async getPhoto(id){
    const key = this.needKey(), r = await this.tx('photos', 'readonly', s => s.get(id));
    if(!r) return null;
    const info = await Crypto.openJson(key, r.info);
    return { id, caseId: r.caseId, ts: r.ts, info, blob: new Blob([await Crypto.open(key, r)], { type: info.type }) };
  },
  async photoIds(caseId){ return this.tx('photos', 'readonly', s => s.index('caseId').getAllKeys(caseId)); },
  async deletePhoto(id){ return this.tx('photos', 'readwrite', s => s.delete(id)); },
  // Автоочистка: фото старше N дней удаляются (время хранится открыто — чистить можно без расшифровки)
  async cleanPhotos(days){
    if(!(days > 0)) return 0;
    const limit = Date.now() - days * 864e5;
    const rows = await this.tx('photos', 'readonly', s => s.getAll());
    const old = rows.filter(r => r.ts < limit).map(r => r.id);
    if(old.length) await this.tx('photos', 'readwrite', s => { old.forEach(k => s.delete(k)); });
    return old.length;
  },

  async getKV(k){
    const key = this.needKey(), r = await this.tx('kv', 'readonly', s => s.get(k));
    if(!r) return null;
    return r.bin ? Crypto.open(key, r) : Crypto.openJson(key, r);
  },
  async setKV(k, v){
    const key = this.needKey();
    const bin = v instanceof Uint8Array;
    const box = bin ? await Crypto.seal(key, v) : await Crypto.sealJson(key, v);
    return this.tx('kv', 'readwrite', s => s.put({ iv: box.iv, ct: box.ct, bin }, k));
  },
  delKV(k){ return this.tx('kv', 'readwrite', s => s.delete(k)); },
  kvKeys(){ return this.tx('kv', 'readonly', s => s.getAllKeys()); },
  saveCfg(){ return this.setKV('cfg', this.cfg); },

  // Резервная копия: один файл, зашифрованный отдельным паролем (тоже PBKDF2 600 000 + AES-GCM)
  async exportBackup(password){
    this.needKey();
    const kv = {};
    for(const k of await this.kvKeys()){ const v = await this.getKV(k); kv[k] = v instanceof Uint8Array ? { bin: b64.enc(v) } : { json: v }; }
    const photos = [];
    for(const r of await this.tx('photos', 'readonly', s => s.getAll())){
      const p = await this.getPhoto(r.id);
      photos.push({ id: p.id, caseId: p.caseId, ts: p.ts, info: p.info, data: b64.enc(new Uint8Array(await p.blob.arrayBuffer())) });
    }
    const payload = enc8.encode(JSON.stringify({ v: 1, made: new Date().toISOString(), cases: this.cases, kv, photos }));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const box = await Crypto.seal(await Crypto.pinKey(password, salt), payload);
    const head = enc8.encode(JSON.stringify({ app: 'snd', v: 1, iter: KDF_ITER, salt: b64.enc(salt), iv: b64.enc(box.iv) }) + '\n');
    return new Blob([head, box.ct], { type: 'application/octet-stream' });
  },
  async importBackup(file, password){
    const key = this.needKey();
    const buf = new Uint8Array(await file.arrayBuffer());
    const nl = buf.indexOf(10);
    let head;
    try { head = JSON.parse(dec8.decode(buf.subarray(0, nl))); } catch(e){ throw new Error('Это не файл резервной копии'); }
    if(head.app !== 'snd') throw new Error('Это не файл резервной копии');
    let data;
    try {
      const raw = await Crypto.open(await Crypto.pinKey(password, b64.dec(head.salt), head.iter), { iv: b64.dec(head.iv), ct: buf.subarray(nl + 1) });
      data = JSON.parse(dec8.decode(raw));
    } catch(e){ throw new Error('Пароль копии не подошёл или файл повреждён'); }
    for(const c of data.cases || []) await this.saveCase(c);
    for(const [k, v] of Object.entries(data.kv || {})) await this.setKV(k, v.bin ? b64.dec(v.bin) : v.json);
    for(const p of data.photos || []){
      const box = await Crypto.seal(key, b64.dec(p.data)), info = await Crypto.sealJson(key, p.info);
      await this.tx('photos', 'readwrite', s => s.put({ id: p.id, caseId: p.caseId, ts: p.ts, iv: box.iv, ct: box.ct, info }));
    }
    await this.loadAll();
    return { cases: (data.cases || []).length, photos: (data.photos || []).length };
  },

  async wipe(){
    this.lock();
    if(this.db){ this.db.close(); this.db = null; }
    await new Promise(res => { const rq = indexedDB.deleteDatabase(DB_NAME); rq.onsuccess = rq.onerror = rq.onblocked = () => res(); });
  }
};
