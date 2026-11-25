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
const fichaLab = (id, spec, aprobada) => ({ id, nombre: 'Prueba ' + id, spec, aprobada, sharpe_anual: 1.2, sharpe_deflactado: 0.97 });
const LAB_JSON = {
  generado: '2026-11-25T03:00:00Z', para_el_servidor_estado: 'aprobadas',
  pruebas: { estrategias_probadas: 2232, aprobadas: 2, probabilidad_sobreajuste: 0.2, sharpe_anual_que_daria_la_suerte: 1.5 },
  procedimiento_fuera_de_muestra: { top5: { rent_anual_pct: 10, sharpe_anual: 1, caida_max_pct: 8, dias: 900 }, comprar_y_mantener_btc: { rent_anual_pct: 30, sharpe_anual: 0.7, caida_max_pct: 60, dias: 900 } },
  periodo: { desde: '2021-02-01', hasta: '2026-11-24' },
  estrategias: [
    fichaLab('lab_cruce_24_168_c0.5_sec_amb_nf_h1', { senal: 'cruce', a: 24, b: 168, forma: 'continua', k: 0.5, modo: 'seccion', lado: 'ambos', filtro: 'ninguno', cada: 1 }, true),
    fichaLab('lab_impulso_168_s_ser_lar_ba_h24', { senal: 'impulso', a: 168, forma: 'signo', modo: 'serie', lado: 'largos', filtro: 'btc_alcista', cada: 24 }, true),
    fichaLab('lab_funding_contra_168_s_ser_amb_nf_h1', { senal: 'funding_contra', a: 168, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, false),
    fichaLab('lab_malo_1', { senal: 'eval', a: 24, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, true),
    fichaLab('tend_24_168', { senal: 'cruce', a: 24, b: 168, forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1 }, true),
  ],
  para_el_servidor: ['lab_cruce_24_168_c0.5_sec_amb_nf_h1', 'lab_impulso_168_s_ser_lar_ba_h24', 'lab_funding_contra_168_s_ser_amb_nf_h1', 'lab_malo_1', 'tend_24_168'],
};
let HUECO_ETH = () => false;
let metaOriginal = null;
globalThis.fetch = async (url, init = {}) => {
  llamadas++;
  const u = new URL(url);
  if (u.host === 'raw.githubusercontent.com' && u.pathname.endsWith('/resultados/ml/senal.json')) { porTipo.ml = (porTipo.ml || 0) + 1; return resp(SENAL()); }
  if (u.host === 'raw.githubusercontent.com') { porTipo.lab = (porTipo.lab || 0) + 1; return resp(LAB_JSON); }
  if (u.host === 'futures.kraken.com' || u.host === 'api.kraken.com') return kraken_simulado(u);
  if (u.host !== 'api.hyperliquid.xyz') throw new Error('Host no simulado ' + u.host);
  if (JSON.parse(init.body).type === 'metaAndAssetCtxs' && HUECO_ETH(AHORA)) { const r = await metaOriginal(url, init); const j = await r.json(); const i = j[0].universe.findIndex((a) => a.name === 'ETH'); j[1][i].markPx = ''; return resp(j); }
  const b = JSON.parse(init.body);
  porTipo[b.type] = (porTipo[b.type] || 0) + 1;
  if (b.type === 'candleSnapshot') { const out = []; for (let t = Math.ceil(b.req.startTime / H) * H; t <= b.req.endTime; t += H) out.push({ t, c: String(precio(b.req.coin, t + H)) }); return resp(out); }
  if (b.type === 'fundingHistory') { const out = []; for (let t = Math.ceil(b.startTime / H) * H; t <= b.endTime && out.length < 500; t += H) out.push({ coin: b.coin, fundingRate: String(0.0000125 + 0.00001 * Math.sin(t / H / 30)), time: t }); return resp(out); }
  if (b.type === 'metaAndAssetCtxs') { const nombres = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE', 'TRUMP']; return resp([{ universe: nombres.map((n) => ({ name: n, maxLeverage: 10 })) }, nombres.map((n) => ({ markPx: String(precio(n, AHORA)), funding: '0.0000125', openInterest: '1000', dayNtlVlm: '1e6' }))]); }
  if (b.type === 'clearinghouseState') { const k = parseInt(b.user.slice(2, 4), 16); return resp({ marginSummary: { accountValue: String(1e6) }, assetPositions: [{ position: { coin: 'BTC', szi: String((k % 2 ? 1 : -1) * 5) } }, { position: { coin: 'TRUMP', szi: '100' } }] }); }
  if (b.type === 'l2Book') { const m = Math.floor(AHORA / MIN); const sesgo = Math.sin(m / 13 + b.coin.length); const lado = (base, s) => Array.from({ length: 20 }, (_, i) => ({ px: String(base + s * i * 0.5), sz: String(1 + Math.abs(Math.sin(m * (i + 1))) + (s < 0 ? Math.max(0, sesgo) : Math.max(0, -sesgo))), n: 3 })); const p = precio(b.coin, AHORA); return resp({ coin: b.coin, time: AHORA, levels: [lado(p - 0.5 + 0.1 * Math.sin(m), -1), lado(p + 0.5 + 0.1 * Math.cos(m), 1)] }); }
  throw new Error('tipo no simulado ' + b.type);
};
metaOriginal = async (url, init) => { const b = JSON.parse(init.body); const nombres = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE', 'TRUMP']; return resp([{ universe: nombres.map((n) => ({ name: n, maxLeverage: 10 })) }, nombres.map((n) => ({ markPx: String(precio(n, AHORA)), funding: '0.0000125', openInterest: '1000', dayNtlVlm: '1e6' }))]); };
// ---------- señal del aprendizaje automático simulada: cierre de ayer ----------
let SENAL_VIEJA = false;
const SENAL = () => ({ version: 1, generado: new Date(AHORA).toISOString().slice(0, 13), fecha: new Date(Math.floor(AHORA / 86400e3) * 86400e3 - (SENAL_VIEJA ? 6 : 1) * 86400e3).toISOString().slice(0, 10),
  cartera: { BTC: 0.1, ETH: 0.1, SOL: 0.1, XRP: 0.1, DOGE: 0.1, BNB: -0.1, HYPE: -0.1, LINK: -0.1, AVAX: -0.1, SUI: -0.1, TRUMP: 0.1, ZEC: 5, ADA: 'x' } });
// ---------- Kraken simulado ----------
let KRAKEN_CAIDO = false;
const KR_SIM = { BTC: ['PF_XBTUSD', 4], DOGE: ['PF_XDGUSD', 0] };
const krSimbolo = (m) => KR_SIM[m] ? KR_SIM[m][0] : m === 'kPEPE' ? 'PF_PEPEUSD' : 'PF_' + m + 'USD';
const krPrec = (m) => KR_SIM[m] ? KR_SIM[m][1] : 1; // paso de 0,1 unidades: con 50 € no llega para casi nada
const MON = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE'];
const krPrecio = (m) => (m === 'kPEPE' ? precio('kPEPE', AHORA) / 1000 : precio(m, AHORA));
async function kraken_simulado(u) {
  porTipo['kr ' + u.pathname] = (porTipo['kr ' + u.pathname] || 0) + 1;
  if (KRAKEN_CAIDO) return new Response('caído', { status: 503 });
  if (u.host === 'api.kraken.com') return resp({ error: [], result: { ZEURZUSD: { c: ['1.0900', '1'] } } });
  if (u.pathname.endsWith('/instruments')) {
    const ins = MON.map((m) => ({ symbol: krSimbolo(m), type: 'flexible_futures', tradeable: true, contractValueTradePrecision: krPrec(m) }));
    ins.push({ symbol: 'PF_1000PEPEUSD', tradeable: true, contractValueTradePrecision: 0 }, { symbol: 'FI_XBTUSD_261225', tradeable: true, contractValueTradePrecision: 4 }, { symbol: 'PF_TRUMPUSD', tradeable: true, contractValueTradePrecision: 1 }, { symbol: 'PF_SOLUSD', tradeable: false, contractValueTradePrecision: 9 });
    return resp({ result: 'success', instruments: ins });
  }
  if (u.pathname.endsWith('/tickers')) {
    const t = MON.map((m) => { const p = krPrecio(m); return { symbol: krSimbolo(m), markPrice: p, bid: p * 0.9997, ask: p * 1.0003, fundingRate: 0.00001 * p, suspended: false }; });
    t.push({ symbol: 'PF_1000PEPEUSD', markPrice: 1, bid: 1, ask: 1 });
    return resp({ result: 'success', tickers: t });
  }
  throw new Error('ruta de Kraken no simulada ' + u.pathname);
}
const { default: worker } = await import('../worker.js');
const check = (c, m) => { console.log((c ? 'OK   ' : 'FALLO') + ' ' + m); if (!c) process.exitCode = 1; };
const ejecutar = async () => { const esperas = []; llamadas = 0; const t0 = process.hrtime.bigint(); await worker.scheduled({}, ENV, { waitUntil: (p) => esperas.push(p) }); await Promise.all(esperas); return { ms: Number(process.hrtime.bigint() - t0) / 1e6, llamadas }; };
const herramienta = async (name, args = {}) => { const r = await worker.fetch(new Request('https://x.workers.dev/mcp/secreto123', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), ENV); const j = await r.json(); return JSON.parse(j.result.content[0].text); };

// ---------- 0) piezas del bot, sueltas ----------
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') + '\nexport { botPaso, botMultiplo, krBase, hlBase, botCartera, apPosiciones, AP_EXPERTOS };\n';
  const tmp = path.join(os.tmpdir(), 'worker_bot_' + process.pid + '.mjs');
  fs.writeFileSync(tmp, fuente);
  const W = await import(tmp);
  fs.unlinkSync(tmp);
  check(JSON.stringify(W.krBase('PF_XBTUSD')) === '["BTC",1]' && JSON.stringify(W.krBase('PF_1000PEPEUSD')) === '["PEPE",1000]' && W.krBase('FI_XBTUSD_261225') === null && JSON.stringify(W.krBase('PF_XDGUSD')) === '["DOGE",1]', 'nombres de Kraken: XBT, XDG, 1000PEPE; los de fecha fija no');
  check(W.hlBase('kPEPE') === 'PEPE' && W.hlBase('BTC') === 'BTC', 'nombres de Hyperliquid: kPEPE es PEPE');
  check(W.botMultiplo(0.00037, 4) === 0.0003 && W.botMultiplo(-2.9999999999999996, 0) === -3 && W.botMultiplo(0.1 + 0.2, 1) === 0.3 && W.botMultiplo(-2.5, 0) === -2 && W.botMultiplo(0.3, 1) === 0.3 && W.botMultiplo(15, -1) === 10, 'cantidades en múltiplos del tamaño mínimo, hacia cero');
  const fichas = { BTC: { sym: 'PF_XBTUSD', prec: 4 }, ETH: { sym: 'PF_ETHUSD', prec: 1 } };
  // 1000 $: 50 % en BTC a 100 $ -> 5 BTC; sube un 10 %: +50 $; funding 0,01 %/h del comprado -> paga 0,055 $
  const C = W.botCartera(1000, 1, 0);
  W.botPaso(C, { BTC: { mark: 100, bid: 99.9, ask: 100.1, rel: 0.0001 } }, { BTC: 0.5 }, fichas, 3600e3, 0);
  const costeEntrada = 5 * 100 * 0.0005 + 5 * 0.1;
  check(C.pos.BTC === 5 && Math.abs(C.valor - (1000 - costeEntrada)) < 1e-9 && C.operaciones === 1, 'entra 5 BTC pagando comisión y medio diferencial: ' + C.valor.toFixed(4));
  W.botPaso(C, { BTC: { mark: 110, bid: 109.9, ask: 110.1, rel: 0.0001 } }, { BTC: 0.5 }, fichas, 7200e3, 1);
  const fun = 5 * 110 * 0.0001;
  check(Math.abs(C.funding - fun) < 1e-12 && C.pos.BTC === 5, 'cobra la subida y paga el funding; la banda no opera por un cambio pequeño: ' + C.valor.toFixed(4) + ' (posición ' + C.pos.BTC + ')');
  check(Math.abs(C.valor - (1000 - costeEntrada + 50 - fun)) < 1e-9, 'valor = inicial − costes + subida − funding');
  // vendido: si baja, gana; funding negativo lo cobra el vendido
  const D = W.botCartera(100, 1, 0);
  W.botPaso(D, { ETH: { mark: 10, bid: 10, ask: 10, rel: -0.001 } }, { ETH: -0.5 }, fichas, 3600e3, 0);
  W.botPaso(D, { ETH: { mark: 9, bid: 9, ask: 9, rel: -0.001 } }, { ETH: -0.5 }, fichas, 7200e3, 1);
  check(D.pos.ETH === -5 && Math.abs(D.valor - (100 - 0.025 + 5 - 0.045)) < 1e-9 && D.funding > 0, 'vendido: gana si baja; con funding negativo paga el vendido: ' + D.valor.toFixed(4));
  const D2 = W.botCartera(100, 1, 0);
  W.botPaso(D2, { ETH: { mark: 10, bid: 10, ask: 10, rel: 0.001 } }, { ETH: -0.5 }, fichas, 3600e3, 0);
  W.botPaso(D2, { ETH: { mark: 10, bid: 10, ask: 10, rel: 0.001 } }, { ETH: -0.5 }, fichas, 7200e3, 1);
  check(D2.funding < 0 && Math.abs(D2.valor - (100 - 0.025 + 0.05)) < 1e-9, 'con funding positivo el vendido cobra: ' + D2.valor.toFixed(4));
  // mínimos: con 50 $ y un 5 % en ETH a 30 $ (paso 0,1 = 3 $ > 2,5 $) no se puede tener
  const P = W.botCartera(50, 1, 0);
  W.botPaso(P, { ETH: { mark: 30, bid: 30, ask: 30, rel: 0 } }, { ETH: 0.05 }, fichas, 3600e3, 0);
  check(!P.pos.ETH && P.operaciones === 0 && P.valor === 50, 'con 50 € no llega al tamaño mínimo: no opera');
  // sin apalancamiento: objetivos que suman más del 100 % se recortan
  const L = W.botCartera(1000, 1, 0);
  W.botPaso(L, { BTC: { mark: 100, bid: 100, ask: 100, rel: 0 }, ETH: { mark: 10, bid: 10, ask: 10, rel: 0 } }, { BTC: 0.8, ETH: -0.8 }, fichas, 3600e3, 0);
  const bruta = Math.abs(L.pos.BTC) * 100 + Math.abs(L.pos.ETH) * 10;
  check(bruta <= L.valor + 1e-9 && bruta > 0.95 * 1000, 'exposición bruta recortada al dinero que hay (después de costes): ' + bruta.toFixed(2) + ' de ' + L.valor.toFixed(2));
  // sin precio de una moneda: no se toca su posición
  W.botPaso(L, { ETH: { mark: 10, bid: 10, ask: 10, rel: 0 } }, { BTC: 0, ETH: -0.5 }, fichas, 7200e3, 1);
  check(L.pos.BTC === 4.9 || L.pos.BTC > 0, 'sin precio de BTC se mantiene su posición: ' + L.pos.BTC);
  // experto de aprendizaje automático: copia la señal mientras no caduque (3 días después del cierre siguiente)
  const exMl = W.AP_EXPERTOS.find((x) => x.id === 'ml_qlib');
  const Em = { ml: { fecha: '2026-11-20', pos: { BTC: 0.1, ETH: -0.1, SOL: 0.1 } }, expertos: {} };
  const t21 = Date.parse('2026-11-21T00:00:00Z');
  const p1 = W.apPosiciones(Em, exMl, ['BTC', 'ETH'], {}, t21 + 3600e3);
  check(JSON.stringify(p1) === JSON.stringify({ BTC: 0.1, ETH: -0.1 }), 'experto ML: copia la señal en las monedas listas (SOL sin memoria se queda fuera): ' + JSON.stringify(p1));
  check(W.apPosiciones(Em, exMl, ['BTC'], {}, t21 - 3600e3) === null, 'experto ML: no usa una señal antes de su cierre');
  check(W.apPosiciones(Em, exMl, ['BTC'], {}, t21 + 3 * 86400e3 + 3600e3) === null, 'experto ML: caducada y aún sin crear, no entra');
  Em.expertos.ml_qlib = {};
  check(JSON.stringify(W.apPosiciones(Em, exMl, ['BTC'], {}, t21 + 3 * 86400e3 + 3600e3)) === '{}', 'experto ML: caducada, se queda sin posición');
  check(W.apPosiciones({ expertos: {} }, exMl, ['BTC'], {}, t21) === null, 'experto ML: sin señal, espera');
  // quiebra: no opera con valor ≤ 0
  const Q = W.botCartera(10, 1, 0);
  W.botPaso(Q, { BTC: { mark: 100, bid: 100, ask: 100, rel: 0 } }, { BTC: -1 }, { BTC: { prec: 2 } }, 3600e3, 0);
  check(Q.pos.BTC === -0.09, 'vendido al 100 % (menos el margen para costes): ' + Q.pos.BTC);
  W.botPaso(Q, { BTC: { mark: 300, bid: 300, ask: 300, rel: 0 } }, { BTC: -1 }, { BTC: { prec: 2 } }, 7200e3, 1);
  check(Q.valor === 0 && Object.keys(Q.pos).length === 0, 'si se queda sin dinero, deja de operar');
}

// ---------- 1) repaso de la historia ----------
let ciclos = 0;
for (; ciclos < 400; ciclos++) {
  await ejecutar();
  const res = await herramienta('aprendizaje', { vista: 'resumen' });
  if (res.rows[0].modo === 'en vivo') break;
  AHORA += MIN;
}
check((await herramienta('aprendizaje', { vista: 'resumen' })).rows[0].modo === 'en vivo', 'el repaso termina (' + (ciclos + 1) + ' minutos)');
const bot0 = await herramienta('aprendizaje', { vista: 'bot' });
check(Array.isArray(bot0.rows) && bot0.rows.length === 0, 'antes de las fichas de Kraken el bot no tiene carteras');

// ---------- 2) en vivo, minuto a minuto, 30 horas (con Kraken caído una hora) ----------
let maxLl = 0, msBot = [], msOtros = [];
const t0 = AHORA;
const caidaDesde = Math.ceil((t0 + 10 * H) / H) * H;
while (AHORA < t0 + 30 * H) {
  AHORA += MIN;
  KRAKEN_CAIDO = AHORA >= caidaDesde && AHORA < caidaDesde + H;
  const r = await ejecutar();
  maxLl = Math.max(maxLl, r.llamadas);
  const min = new Date(AHORA).getUTCMinutes();
  (min === 7 ? msBot : msOtros).push(r.ms);
}
check(maxLl <= 50, 'peticiones externas por minuto: máximo ' + maxLl + ' (límite 50)');
const ins = porTipo['kr /derivatives/api/v3/instruments'] || 0;
check(ins >= 1 && ins <= 4, 'fichas de Kraken pedidas pocas veces: ' + ins + ' en 30 h (una al día y reintentos)');
const bot = await herramienta('aprendizaje', { vista: 'bot' });
check(bot.rows.length === 3 && bot.rows.map((r) => r.capitalEur).join() === '50,200,1000', 'tres carteras: 50, 200 y 1000 €');
const horasBot = bot.rows[0].horas;
check(horasBot >= 25 && horasBot <= 29, 'el bot opera cada hora desde que tiene fichas: ' + horasBot + ' h');
const tk = porTipo['kr /derivatives/api/v3/tickers'] || 0;
check(tk >= horasBot + 1 && tk <= horasBot + 1 + 12, 'una lectura de Kraken por hora, más los reintentos de la hora caída (6 minutos × 2): ' + tk);
for (const r of bot.rows) {
  const bruta = r.posiciones.reduce((a, p) => a + Math.abs(p.valorEur), 0);
  check(r.valorEur > 0 && r.comisionesEur > 0 && r.diferencialEur > 0 && r.operaciones > 0 && bruta <= r.valorEur * 1.0001, r.capitalEur + ' €: vale ' + r.valorEur.toFixed(2) + ' € (' + r.gananciaPct.toFixed(2) + ' %; sistema ideal ' + (r.sistemaIdealPct == null ? '—' : r.sistemaIdealPct.toFixed(2) + ' %') + '), ' + r.operaciones + ' operaciones, comisiones ' + r.comisionesEur.toFixed(3) + ' €, funding ' + r.fundingEur.toFixed(3) + ' €, ' + r.posiciones.length + ' posiciones, exposición ' + bruta.toFixed(2) + ' €');
  check(r.posiciones.every((p) => { const prec = p.contrato === 'PF_XBTUSD' ? 4 : p.contrato === 'PF_XDGUSD' ? 0 : 1; return Math.abs(p.cantidad * 10 ** prec - Math.round(p.cantidad * 10 ** prec)) < 1e-6; }), r.capitalEur + ' €: todas las cantidades son múltiplos del tamaño mínimo');
  check(!r.posiciones.some((p) => p.contrato === 'PF_1000PEPEUSD' || p.contrato === 'PF_TRUMPUSD'), r.capitalEur + ' €: usa PF_PEPEUSD y no otros contratos');
  check(r.curva.length >= 1, r.capitalEur + ' €: curva diaria con ' + r.curva.length + ' puntos');
}
check(bot.rows[0].posiciones.length < bot.rows[2].posiciones.length, 'con 50 € caben menos posiciones que con 1000 € (mínimos): ' + bot.rows[0].posiciones.length + ' frente a ' + bot.rows[2].posiciones.length);
check(Math.abs(bot.eurUsd - 1.09) < 1e-9, 'EUR/USD de Kraken: ' + bot.eurUsd);
const estB = db.prepare("SELECT length(json) AS b FROM ap_estado WHERE id = 'bot'").get();
check(estB.b < 60000, 'estado del bot pequeño: ' + estB.b + ' bytes');
msBot.sort((a, b) => a - b); msOtros.sort((a, b) => a - b);
console.log('     tiempo en el minuto :07 (bot): mediana ' + msBot[Math.floor(msBot.length / 2)].toFixed(1) + ' ms, máx ' + msBot[msBot.length - 1].toFixed(1) + ' ms; resto: mediana ' + msOtros[Math.floor(msOtros.length / 2)].toFixed(1) + ' ms');
const ml = await herramienta('aprendizaje', { vista: 'ml' });
check(ml.rows.length === 10 && ml.rows.filter((r) => r.lado === 'comprar').length === 5 && !ml.rows.some((r) => ['TRUMP', 'ZEC', 'ADA'].includes(r.moneda)), 'señal ML leída: 5 compradas y 5 vendidas; descarta monedas desconocidas, pesos excesivos y valores no numéricos');
const expMl = (await herramienta('aprendizaje', { vista: 'expertos' })).rows.find((x) => x.id === 'ml_qlib');
const pesosIni = (await herramienta('aprendizaje', { vista: 'expertos' })).rows.filter((x) => x.horas > 0);
check(expMl && expMl.horas > 0 && expMl.pesoPct > 0 && expMl.pesoPct < 100 / pesosIni.length, 'experto ML aprende en vivo con poco peso: ' + (expMl && expMl.horas) + ' h, ' + (expMl && expMl.pesoPct.toFixed(2)) + ' % (media ' + (100 / pesosIni.length).toFixed(2) + ' %)');
check((porTipo.ml || 0) >= 8 && (porTipo.ml || 0) <= 12, 'la señal se mira cada 3 horas: ' + porTipo.ml + ' veces en 30 h');
const alML = (await herramienta('aprendizaje', { vista: 'alertas' })).rows.filter((a) => a.tipo === 'ml');
check(alML.length >= 1 && alML.length <= 3, 'avisa cuando cambia la cartera del aprendizaje automático (no en cada lectura): ' + alML.length);
const pr = await herramienta('aprendizaje', { vista: 'resumen' });
check(pr.rows[0].modo === 'en vivo', 'el sistema sigue en vivo con el bot funcionando');
Date.now = realNow;
