import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
// D1 mínimo sobre SQLite
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  _run: () => db.prepare(sql).run(...args),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (ops) => { for (const o of ops) o._run(); return []; } };
const ENV = { TOKEN: 'secreto123', DB };
const H = 3600e3, MIN = 60e3;
let AHORA = Date.UTC(2026, 10, 24, 21, 30, 0);
const realNow = Date.now; Date.now = () => AHORA;
const RealDate = Date;
let llamadas = 0, porTipo = {};
// mercado sintético determinista: precio = f(moneda, hora)
const precio = (m, t) => { let s = 0; for (const ch of m) s += ch.charCodeAt(0); const h = Math.floor(t / H); return 100 * (1 + (s % 7)) * Math.exp(0.02 * Math.sin(h / 50 + s) + 0.01 * Math.sin(h / 7 + s * 3)); };
const resp = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  llamadas++;
  const u = new URL(url);
  if (u.host !== 'api.hyperliquid.xyz') throw new Error('Host no simulado ' + u.host);
  const b = JSON.parse(init.body);
  porTipo[b.type] = (porTipo[b.type] || 0) + 1;
  if (b.type === 'candleSnapshot') { const out = []; for (let t = Math.ceil(b.req.startTime / H) * H; t <= b.req.endTime; t += H) out.push({ t, c: String(precio(b.req.coin, t + H)) }); return resp(out); }
  if (b.type === 'fundingHistory') { const out = []; for (let t = Math.ceil(b.startTime / H) * H; t <= b.endTime && out.length < 500; t += H) out.push({ coin: b.coin, fundingRate: String(0.0000125 + 0.00001 * Math.sin(t / H / 30)), time: t }); return resp(out); }
  if (b.type === 'metaAndAssetCtxs') { const nombres = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE', 'TRUMP']; return resp([{ universe: nombres.map((n) => ({ name: n, maxLeverage: 10 })) }, nombres.map((n) => ({ markPx: String(precio(n, AHORA)), funding: '0.0000125', openInterest: '1000', dayNtlVlm: '1e6' }))]); }
  if (b.type === 'clearinghouseState') { const k = parseInt(b.user.slice(2, 4), 16); return resp({ marginSummary: { accountValue: String(1e6) }, assetPositions: [{ position: { coin: 'BTC', szi: String((k % 2 ? 1 : -1) * 5) } }, { position: { coin: 'TRUMP', szi: '100' } }] }); }
  if (b.type === 'l2Book') { const m = Math.floor(AHORA / MIN); const sesgo = Math.sin(m / 13 + b.coin.length); const lado = (base, s) => Array.from({ length: 20 }, (_, i) => ({ px: String(base + s * i * 0.5), sz: String(1 + Math.abs(Math.sin(m * (i + 1))) + (s < 0 ? Math.max(0, sesgo) : Math.max(0, -sesgo))), n: 3 })); const p = precio(b.coin, AHORA); return resp({ coin: b.coin, time: AHORA, levels: [lado(p - 0.5 + 0.1 * Math.sin(m), -1), lado(p + 0.5 + 0.1 * Math.cos(m), 1)] }); }
  throw new Error('tipo no simulado ' + b.type);
};
const { default: worker } = await import('../worker.js');
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLO') + ' ' + m); if (!c) process.exitCode = 1; };
const ejecutar = async () => { const esperas = []; llamadas = 0; const t0 = process.hrtime.bigint(); await worker.scheduled({}, ENV, { waitUntil: (p) => esperas.push(p) }); await Promise.all(esperas); return { ms: Number(process.hrtime.bigint() - t0) / 1e6, llamadas }; };
const herramienta = async (name, args = {}) => { const r = await worker.fetch(new Request('https://x.workers.dev/mcp/secreto123', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), ENV); const j = await r.json(); return JSON.parse(j.result.content[0].text); };
// 1) repaso de la historia
let maxLl = 0, maxMs = 0, ciclos = 0, msTot = 0;
for (; ciclos < 400; ciclos++) {
  const r = await ejecutar(); maxLl = Math.max(maxLl, r.llamadas); msTot += r.ms; if (ciclos > 5) maxMs = Math.max(maxMs, r.ms);
  const res = await herramienta('aprendizaje', { vista: 'resumen' });
  if (res.rows[0].modo === 'en vivo') break;
  AHORA += MIN;
}
const res0 = (await herramienta('aprendizaje', { vista: 'resumen' })).rows[0];
check(res0.modo === 'en vivo', 'el repaso termina en ' + (ciclos + 1) + ' ciclos de un minuto (' + res0.horasAprendidas + ' horas aprendidas)');
check(maxLl <= 50, 'peticiones externas por ciclo durante el repaso: máximo ' + maxLl + ' (límite 50)');
console.log('     tiempo por ciclo de repaso (incluye SQLite y simulación): media ' + (msTot / (ciclos + 1)).toFixed(1) + ' ms, máximo ' + maxMs.toFixed(1) + ' ms');
// 2) en vivo, minuto a minuto durante 8 horas
let maxVivo = 0, horasVivas = 0, cpuMin = [];
const t0 = AHORA;
while (AHORA < t0 + 8 * H) {
  AHORA += MIN;
  const r = await ejecutar(); maxVivo = Math.max(maxVivo, r.llamadas); cpuMin.push(r.ms);
}
check(maxVivo <= 50, 'peticiones externas por minuto en vivo: máximo ' + maxVivo + ' (la hora en vivo usa 31; el flujo, 20; +2 al calentar)');
const exp = (await herramienta('aprendizaje', { vista: 'expertos' })).rows;
const flujo = exp.filter((x) => x.familia === 'flujo de órdenes');
check(flujo.length === 4 && flujo.every((x) => x.horas > 0), 'los 4 expertos de flujo de órdenes aprenden en vivo: ' + flujo.map((x) => x.id + ' ' + x.horas + ' h').join(', '));
check(exp.length === 23, 'hay 23 expertos en total (con el de aprendizaje automático, sin señal): ' + exp.length);
const pos = (await herramienta('aprendizaje', { vista: 'posiciones' })).rows;
check(pos.length === 21, '20 mercados más el cobro del funding en las posiciones: ' + pos.length);
const res1 = (await herramienta('aprendizaje', { vista: 'resumen' })).rows[0];
console.log('     resumen:', JSON.stringify(res1));
const est = db.prepare("SELECT length(json) AS b FROM ap_estado WHERE id = 'principal'").get();
console.log('     tamaño del estado:', est.b, 'bytes; peticiones por tipo:', JSON.stringify(porTipo));
cpuMin.sort((a, b) => a - b);
console.log('     tiempo por minuto en vivo: mediana ' + cpuMin[Math.floor(cpuMin.length / 2)].toFixed(1) + ' ms, p95 ' + cpuMin[Math.floor(cpuMin.length * 0.95)].toFixed(1) + ' ms');
const car = (await herramienta('aprendizaje', { vista: 'carteras' })).rows;
check(car.length === 30 && car[0].horas >= 7, '30 carteras seguidas con horas de historial: ' + car[0].horas);
