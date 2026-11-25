// Radar de mercados: servidor MCP propio para Claude.
// Un Cloudflare Worker sin dependencias. Pega este archivo entero en el editor del Worker.
//
// Fuentes públicas, sin clave:
//   - Cripto (mercado real): Kraken. Si Kraken no la tiene o falla: perpetuo de Hyperliquid
//     y, en último caso, Binance (que bloquea las IP de Cloudflare).
//   - Oro, plata, petróleo, S&P 500, Nasdaq 100 aprox., divisas y acciones de EE. UU.:
//     perpetuos de trade.xyz en Hyperliquid (dex "xyz"). Son una APROXIMACIÓN del mercado
//     de referencia: lo siguen con el mercado abierto; fuera de horario es precio interno.
//
// Protección: crea en el Worker un secreto llamado TOKEN. La dirección del conector es
//   https://<tu-worker>.workers.dev/mcp/<TOKEN>
// Comprobación rápida en el navegador: https://<tu-worker>.workers.dev/prueba/<TOKEN>
//
// Sistema que aprende (v2): necesita una base de datos D1 conectada al Worker con el nombre DB
// y un disparador Cron cada minuto (* * * * *). Primero repasa unas 5000 horas de historia, 16 por minuto;
// después aprende cada hora en vivo. Todo en papel: no mueve dinero.

const VERSION = '2.4.1';
const HL = 'https://api.hyperliquid.xyz/info';
const BINANCE = 'https://data-api.binance.vision/api/v3';
const KRAKEN = 'https://api.kraken.com/0/public';
const BITSTAMP = 'https://www.bitstamp.net/api/v2';
const NOTA_XYZ = 'Perpetuo de trade.xyz en Hyperliquid: sigue al mercado de referencia cuando está abierto; fuera de horario es precio interno.';

const CATALOGO = {
  BTC: { nombre: 'Bitcoin', grupo: 'cripto', binance: 'BTCUSDT', kraken: 'XBTUSD' , hl: 'BTC' },
  ETH: { nombre: 'Ethereum', grupo: 'cripto', binance: 'ETHUSDT', kraken: 'ETHUSD' , hl: 'ETH' },
  BNB: { nombre: 'BNB', grupo: 'cripto', hl: 'BNB', binance: 'BNBUSDT' },
  XRP: { nombre: 'XRP', grupo: 'cripto', binance: 'XRPUSDT', kraken: 'XRPUSD' , hl: 'XRP' },
  SOL: { nombre: 'Solana', grupo: 'cripto', binance: 'SOLUSDT', kraken: 'SOLUSD' , hl: 'SOL' },
  DOGE: { nombre: 'Dogecoin', grupo: 'cripto', binance: 'DOGEUSDT', kraken: 'XDGUSD' , hl: 'DOGE' },
  LINK: { nombre: 'Chainlink', grupo: 'cripto', binance: 'LINKUSDT', kraken: 'LINKUSD' , hl: 'LINK' },
  ADA: { nombre: 'Cardano', grupo: 'cripto', binance: 'ADAUSDT', kraken: 'ADAUSD' , hl: 'ADA' },
  ORO: { nombre: 'Oro', grupo: 'materias primas', xyz: ['GOLD', 'XAU'] },
  PLATA: { nombre: 'Plata', grupo: 'materias primas', xyz: ['SILVER', 'XAG'] },
  WTI: { nombre: 'Petróleo WTI', grupo: 'materias primas', xyz: ['CL', 'WTI', 'WTIOIL'] },
  BRENT: { nombre: 'Petróleo Brent', grupo: 'materias primas', xyz: ['BRENTOIL', 'BRENT'] },
  SP500: { nombre: 'S&P 500', grupo: 'índices', xyz: ['SP500', 'S&P500', 'SPX'] },
  NASDAQ100: { nombre: 'Nasdaq 100 (aprox. XYZ100)', grupo: 'índices', xyz: ['XYZ100', 'NDX', 'NAS100'] },
  EURUSD: { nombre: 'Euro / dólar', grupo: 'divisas', xyz: ['EUR', 'EURUSD'] },
  GBPUSD: { nombre: 'Libra / dólar', grupo: 'divisas', xyz: ['GBP', 'GBPUSD'] },
  USDJPY: { nombre: 'Dólar / yen', grupo: 'divisas', xyz: ['JPY', 'USDJPY'] },
};
const LISTA_DEFECTO = Object.keys(CATALOGO);
// Historial diario largo (Bitstamp publica velas diarias desde hace muchos años).
const HISTORICO = { BTC: { bitstamp: 'btcusd', desde: '2015-01-01' }, ETH: { bitstamp: 'ethusd', desde: '2016-06-01' } };
const DERIVADOS_DEFECTO = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'LINK', 'ADA'];
const INTERVALOS = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };

// ---------- utilidades ----------
const CACHE = new Map();
function cacheado(clave, ttlMs, fn) {
  const h = CACHE.get(clave);
  if (h && Date.now() - h.t < ttlMs) return h.p;
  const p = fn();
  CACHE.set(clave, { t: Date.now(), p });
  p.catch(() => CACHE.delete(clave));
  return p;
}
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function pedir(url, init = {}, intentos = 3) {
  const host = new URL(url).host;
  let ultimo = new Error('Sin respuesta de ' + host);
  for (let i = 0; i < intentos; i++) {
    if (i) await espera(400 * 3 ** (i - 1));
    let r;
    try {
      r = await fetch(url, { ...init, headers: { 'User-Agent': 'radar-mercados/' + VERSION, ...(init.headers || {}) } });
    } catch (e) { ultimo = new Error(host + ': ' + (e.message || e)); continue; }
    if (r.status === 429 || r.status >= 500) { ultimo = new Error(host + ' respondió ' + r.status); continue; }
    if (!r.ok) throw new Error(host + ' respondió ' + r.status);
    return r.json();
  }
  throw ultimo;
}
const hl = (cuerpo) => pedir(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
const num = (v) => (v == null || v === '' ? null : Number(v));
const pct = (a, b) => (a != null && b ? (a / b - 1) * 100 : null);
const iso = (ms) => new Date(ms).toISOString();
const sinDex = (n) => String(n).split(':').pop().toUpperCase();

// ---------- Hyperliquid (dex xyz) ----------
function xyzUniverso() {
  return cacheado('xyz-meta', 10 * 60e3, async () => {
    const m = await hl({ type: 'meta', dex: 'xyz' });
    const u = (m && m.universe) || [];
    return u.filter((a) => !a.isDelisted).map((a) => (String(a.name).includes(':') ? a.name : 'xyz:' + a.name));
  });
}
function xyzContextos() {
  return cacheado('xyz-ctx', 15e3, async () => {
    const [meta, ctxs] = await hl({ type: 'metaAndAssetCtxs', dex: 'xyz' });
    const mapa = new Map();
    (meta.universe || []).forEach((a, i) => {
      const coin = String(a.name).includes(':') ? a.name : 'xyz:' + a.name;
      if (!a.isDelisted && ctxs[i]) mapa.set(coin, ctxs[i]);
    });
    return mapa;
  });
}
function hlContextos() {
  return cacheado('hl-ctx', 15e3, async () => {
    const [meta, ctxs] = await hl({ type: 'metaAndAssetCtxs' });
    const mapa = new Map();
    (meta.universe || []).forEach((a, i) => { if (!a.isDelisted && ctxs[i]) mapa.set(a.name, { ...ctxs[i], maxLeverage: num(a.maxLeverage) }); });
    return mapa;
  });
}
async function xyzVelas(coin, intervalo, n) {
  const ahora = Date.now();
  const ms = INTERVALOS[intervalo] * 60e3;
  const v = await hl({ type: 'candleSnapshot', req: { coin, interval: intervalo, startTime: ahora - (n + 3) * ms, endTime: ahora } });
  if (!Array.isArray(v)) throw new Error('Hyperliquid no devolvió velas de ' + coin);
  return v.slice(-n).map((c) => ({ t: iso(c.t), o: num(c.o), h: num(c.h), l: num(c.l), c: num(c.c), v: num(c.v) }));
}

// ---------- Binance y Kraken (cripto) ----------
async function binanceVelas(par, intervalo, n) {
  const v = await pedir(BINANCE + '/klines?symbol=' + par + '&interval=' + intervalo + '&limit=' + n);
  return v.map((k) => ({ t: iso(k[0]), o: num(k[1]), h: num(k[2]), l: num(k[3]), c: num(k[4]), v: num(k[5]) }));
}
async function binancePrecios(pares) {
  const consulta = (lista) => pedir(BINANCE + '/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(lista)) + '&type=MINI');
  let v;
  try {
    v = await consulta(pares);
  } catch (e) {
    // Un símbolo inexistente hace fallar el lote entero: se pide cada par por separado.
    if (pares.length < 2) throw e;
    const sueltos = await Promise.allSettled(pares.map((p) => consulta([p])));
    v = sueltos.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value);
    if (!v.length) throw e;
  }
  const mapa = new Map();
  for (const t of v) mapa.set(t.symbol, { precio: num(t.lastPrice), cambioPct: pct(num(t.lastPrice), num(t.openPrice)), referencia: '24 h' });
  return mapa;
}
async function kraken(ruta) {
  const r = await pedir(KRAKEN + '/' + ruta);
  if (r.error && r.error.length) throw new Error('Kraken: ' + r.error.join(', '));
  return r.result;
}
async function krakenVelas(par, intervalo, n) {
  const res = await kraken('OHLC?pair=' + par + '&interval=' + INTERVALOS[intervalo]);
  const clave = Object.keys(res).find((k) => k !== 'last');
  return res[clave].slice(-n).map((k) => ({ t: iso(k[0] * 1000), o: num(k[1]), h: num(k[2]), l: num(k[3]), c: num(k[4]), v: num(k[6]) }));
}
async function krakenPrecios(pares) {
  const nombres = await cacheado('kr-pares', 6 * 3600e3, async () => {
    const r = await kraken('AssetPairs?pair=' + pares.join(','));
    const m = {};
    for (const [k, v] of Object.entries(r)) m[k] = v.altname;
    return m;
  });
  const res = await kraken('Ticker?pair=' + pares.join(','));
  const mapa = new Map();
  for (const [k, t] of Object.entries(res)) {
    const precio = num(t.c[0]);
    mapa.set(nombres[k] || k, { precio, cambioPct: pct(precio, num(t.o)), referencia: 'desde 00:00 UTC' });
  }
  return mapa;
}

// ---------- historial diario largo ----------
const DIA = 86400e3;
const fechaDe = (ms) => new Date(ms).toISOString().slice(0, 10);
async function bitstampDiario(par, desdeMs) {
  // Bitstamp devuelve la ventana [start, start + 1000 días). Si el par aún no cotizaba al principio de la ventana,
  // la página viene incompleta aunque haya más datos después: se avanza por ventanas hasta llegar a hoy.
  const filas = [];
  const fin = Math.floor(Date.now() / 1000);
  let start = Math.floor(desdeMs / 1000);
  for (let pagina = 0; pagina < 10 && start < fin; pagina++) {
    const r = await pedir(BITSTAMP + '/ohlc/' + par + '/?step=86400&limit=1000&start=' + start);
    const velas = r && r.data && Array.isArray(r.data.ohlc) ? r.data.ohlc : [];
    for (const k of velas) filas.push({ t: Number(k.timestamp) * 1000, o: num(k.open), h: num(k.high), l: num(k.low), c: num(k.close) });
    const ultimo = velas.length ? Number(velas[velas.length - 1].timestamp) : start;
    start = Math.max(ultimo, start + 999 * 86400) + 86400;
  }
  return filas;
}
async function historicoDiario({ simbolo, desde } = {}) {
  const r = await resolver(simbolo);
  const conf = HISTORICO[r.simbolo] || {};
  const desdeTxt = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(desde || '')) ? desde : (conf.desde || '2018-01-01');
  const desdeMs = Date.parse(desdeTxt + 'T00:00:00Z');
  return cacheado('hist:' + r.simbolo + ':' + desdeTxt, 3600e3, async () => {
    const intentos = [];
    if (conf.bitstamp) intentos.push(async () => ({ velas: await bitstampDiario(conf.bitstamp, desdeMs), fuente: 'Bitstamp', idFuente: conf.bitstamp, tipo: TIPO.cripto }));
    if (r.clase === 'cripto' && r.kraken) intentos.push(async () => ({ velas: (await krakenVelas(r.kraken, '1d', 720)).map((v) => ({ ...v, t: Date.parse(v.t) })), fuente: FUENTE.kraken, idFuente: r.kraken, tipo: TIPO.cripto }));
    const coinHl = r.clase === 'xyz' ? r.coin : r.hl;
    if (coinHl) intentos.push(async () => {
      const v = await hl({ type: 'candleSnapshot', req: { coin: coinHl, interval: '1d', startTime: desdeMs, endTime: Date.now() } });
      if (!Array.isArray(v)) throw new Error('Hyperliquid no devolvió velas diarias de ' + coinHl);
      return { velas: v.map((c) => ({ t: c.t, o: num(c.o), h: num(c.h), l: num(c.l), c: num(c.c) })), fuente: r.clase === 'xyz' ? FUENTE.xyz : FUENTE.hl, idFuente: coinHl, tipo: TIPO.xyz };
    });
    const fallos = [];
    for (const f of intentos) {
      try {
        const d = await f();
        const porDia = new Map();
        for (const v of d.velas) if (v.t >= desdeMs && v.c != null) porDia.set(fechaDe(v.t), v);
        const velas = [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([fecha, v]) => ({ simbolo: r.simbolo, fecha, o: v.o, h: v.h, l: v.l, c: v.c }));
        if (velas.length < 30) { fallos.push(d.fuente + ': solo ' + velas.length + ' días'); continue; }
        return { rows: velas, simbolo: r.simbolo, fuente: d.fuente, idFuente: d.idFuente, tipo: d.tipo, desde: velas[0].fecha, hasta: velas[velas.length - 1].fecha, dias: velas.length, nota: 'Una fila por día (UTC). El último día puede estar en curso.' };
      } catch (e) { fallos.push(e.message); }
    }
    throw new Error('Sin historial diario de ' + r.simbolo + ': ' + fallos.join(' / '));
  });
}

// ---------- derivados: financiación y posiciones abiertas ----------
async function historialFunding(coin) {
  return cacheado('fund:' + coin, 10 * 60e3, async () => {
    const fin = Date.now();
    let inicio = fin - 30 * DIA;
    const filas = [];
    for (let pagina = 0; pagina < 3 && inicio < fin; pagina++) {
      const v = await hl({ type: 'fundingHistory', coin, startTime: inicio, endTime: fin });
      if (!Array.isArray(v) || !v.length) break;
      for (const f of v) filas.push({ t: Number(f.time), tasa: num(f.fundingRate) });
      const ultimo = Number(v[v.length - 1].time);
      if (v.length < 500 || ultimo <= inicio) break;
      inicio = ultimo + 1;
    }
    return filas;
  });
}
async function derivados({ simbolos } = {}) {
  const lista = (Array.isArray(simbolos) && simbolos.length ? simbolos : DERIVADOS_DEFECTO).slice(0, 12).map((s) => String(s).trim().toUpperCase());
  const ctx = await hlContextos();
  const rows = [], errores = [];
  await Promise.all(lista.map(async (s) => {
    const def = CATALOGO[s];
    const coin = (def && def.hl) || s;
    const c = ctx.get(coin);
    if (!c) { errores.push({ simbolo: s, error: 'Hyperliquid no tiene el perpetuo ' + coin }); return; }
    const tasa = num(c.funding);
    const mark = num(c.markPx), oraculo = num(c.oraclePx);
    let media7d = null, percentil30d = null, muestras = 0;
    try {
      const h = await historialFunding(coin);
      muestras = h.length;
      if (h.length) {
        const ult7 = h.filter((f) => f.t >= Date.now() - 7 * DIA);
        if (ult7.length) media7d = ult7.reduce((a, f) => a + f.tasa, 0) / ult7.length;
        percentil30d = (h.filter((f) => f.tasa <= tasa).length / h.length) * 100;
      }
    } catch (e) { errores.push({ simbolo: s, error: 'historial de funding: ' + e.message }); }
    const anual = (x) => (x == null ? null : x * 24 * 365 * 100);
    const fundingAnualPct = anual(tasa);
    let estado = 'normal';
    if ((percentil30d != null && percentil30d >= 95) || (fundingAnualPct != null && fundingAnualPct >= 50)) estado = 'extremo alto';
    else if ((percentil30d != null && percentil30d <= 5) || (fundingAnualPct != null && fundingAnualPct <= -30)) estado = 'extremo bajo';
    rows.push({
      simbolo: s, coin, precio: mark, fundingHora: tasa, fundingAnualPct, fundingMedia7dAnualPct: anual(media7d), percentil30d, muestras30d: muestras,
      openInterestUsd: num(c.openInterest) != null && mark != null ? num(c.openInterest) * mark : null,
      primaPct: mark != null && oraculo ? (mark / oraculo - 1) * 100 : null, volumen24hUsd: num(c.dayNtlVlm), apalancamientoMax: c.maxLeverage == null ? null : c.maxLeverage, estado,
    });
  }));
  const orden = new Map(lista.map((s, i) => [s, i]));
  rows.sort((a, b) => orden.get(a.simbolo) - orden.get(b.simbolo));
  return { rows, errores, generado: iso(Date.now()), nota: 'Funding horario de los perpetuos de Hyperliquid, anualizado (×24×365). Positivo: los largos pagan a los cortos. Percentil frente a las últimas 720 horas.' };
}

// ---------- funding diario (para el motor de cobro del funding) ----------
async function fundingDiario({ simbolos, dias } = {}) {
  const lista = (Array.isArray(simbolos) && simbolos.length ? simbolos : ['BTC', 'ETH']).slice(0, 4).map((s) => String(s).trim().toUpperCase());
  const n = Math.min(90, Math.max(7, Math.floor(Number(dias) || 60)));
  const hoyMs = Date.parse(fechaDe(Date.now()) + 'T00:00:00Z');
  const desdeMs = hoyMs - n * DIA;
  const rows = [], errores = [];
  for (const s of lista) {
    const def = CATALOGO[s];
    const coin = (def && def.hl) || s;
    try {
      const horas = await cacheado('fdia:' + coin + ':' + n + ':' + hoyMs, 30 * 60e3, async () => {
        const filas = [];
        let inicio = desdeMs;
        for (let pagina = 0; pagina < 6 && inicio < hoyMs; pagina++) {
          const v = await hl({ type: 'fundingHistory', coin, startTime: inicio, endTime: hoyMs - 1 });
          if (!Array.isArray(v) || !v.length) break;
          for (const f of v) filas.push({ t: Number(f.time), tasa: num(f.fundingRate) });
          const ultimo = Number(v[v.length - 1].time);
          if (v.length < 500 || ultimo <= inicio) break;
          inicio = ultimo + 1;
        }
        return filas;
      });
      const porDia = new Map();
      for (const h of horas) {
        if (h.t < desdeMs || h.t >= hoyMs || h.tasa == null) continue;
        const f = fechaDe(h.t);
        const a = porDia.get(f) || { funding: 0, horas: 0, horasPositivas: 0 };
        a.funding += h.tasa; a.horas++; if (h.tasa > 0) a.horasPositivas++;
        porDia.set(f, a);
      }
      for (const [fecha, a] of [...porDia.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) rows.push({ simbolo: s, coin, fecha, funding: a.funding, horas: a.horas, horasPositivas: a.horasPositivas });
    } catch (e) { errores.push({ simbolo: s, error: e.message }); }
  }
  return { rows, errores, generado: iso(Date.now()), nota: 'Suma diaria (UTC) de las tasas horarias de funding de Hyperliquid. Solo días cerrados. Positivo: los largos pagan a los cortos.' };
}

// ---------- motor que aprende (aprendizaje en línea, hora a hora) ----------
// Cada hora: 1) cobra o paga a cada experto lo que hicieron sus posiciones de la hora anterior,
// 2) actualiza su memoria del mercado (medias, volatilidad, funding, carteras seguidas),
// 3) reparte el peso entre expertos según lo que han ganado (pesos multiplicativos con reparto fijo),
// 4) calcula las posiciones nuevas. Todo en papel: no mueve dinero.
const AP = {
  // XMR sí está en el dex principal de Hyperliquid (comprobado en producción el 25-11-2026: metaAndAssetCtxs sin dex,
  // no retirado, 5x, 70 M$ abiertos). Si alguna moneda desapareciera, el repaso la tolera (ver apCiclo) y no se calienta.
  MONEDAS: ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI', 'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE'],
  CARRY_BASE: ['BTC', 'ETH'],
  SPANS: [12, 24, 72, 168, 336, 720],
  COMISION: 0.00045,
  COSTE_CARRY: 0.0011,
  PARTE_CARRY: 2 / 3,
  ETA: 10,
  REPARTO: 0.0002,
  VOL_OBJ_H: 0.5 / Math.sqrt(8760),
  HORAS_MIN: 720,
  MAX_ALERTAS: 30,
  BANDA: 0.25,
  HORAS_FLUJO: 4,
  // Nº de pruebas para el Sharpe deflactado: como mínimo, las variantes que se miraron al diseñar los expertos (no solo
  // los 22 que quedaron). Criterio de quien firma; cuando entren las estrategias del laboratorio, su nº real de pruebas.
  PRUEBAS: 100,
};

// Expertos: cada uno da, para cada moneda, una señal entre -1 (vender) y +1 (comprar).
const AP_EXPERTOS = [
  { id: 'tend_12_72', nombre: 'Tendencia rápida (12 h / 3 días)', familia: 'tendencia', tipo: 'dir', fn: (c) => Math.sign(c.ema[12] - c.ema[72]) },
  { id: 'tend_24_168', nombre: 'Tendencia (1 día / 1 semana)', familia: 'tendencia', tipo: 'dir', fn: (c) => Math.sign(c.ema[24] - c.ema[168]) },
  { id: 'tend_72_336', nombre: 'Tendencia (3 días / 2 semanas)', familia: 'tendencia', tipo: 'dir', fn: (c) => Math.sign(c.ema[72] - c.ema[336]) },
  { id: 'tend_168_720', nombre: 'Tendencia lenta (1 semana / 1 mes)', familia: 'tendencia', tipo: 'dir', fn: (c) => Math.sign(c.ema[168] - c.ema[720]) },
  { id: 'tendL_24_168', nombre: 'Tendencia solo compras (1 día / 1 semana)', familia: 'tendencia', tipo: 'dir', fn: (c) => Math.max(0, Math.sign(c.ema[24] - c.ema[168])) },
  { id: 'tendL_168_720', nombre: 'Tendencia solo compras (1 semana / 1 mes)', familia: 'tendencia', tipo: 'dir', fn: (c) => Math.max(0, Math.sign(c.ema[168] - c.ema[720])) },
  { id: 'mom_24', nombre: 'Impulso de 1 día', familia: 'impulso', tipo: 'dir', fn: (c) => Math.sign(c.lp - c.ema[24]) },
  { id: 'mom_168', nombre: 'Impulso de 1 semana', familia: 'impulso', tipo: 'dir', fn: (c) => Math.sign(c.lp - c.ema[168]) },
  { id: 'mom_720', nombre: 'Impulso de 1 mes', familia: 'impulso', tipo: 'dir', fn: (c) => Math.sign(c.lp - c.ema[720]) },
  { id: 'rev_12', nombre: 'Rebote a corto plazo (12 h)', familia: 'reversión', tipo: 'dir', fn: (c) => -Math.sign(c.lp - c.ema[12]) },
  { id: 'rev_24z', nombre: 'Rebote tras excesos (1 día)', familia: 'reversión', tipo: 'dir', fn: (c) => { const s = Math.sqrt(c.v2) * Math.sqrt(12); return s > 0 ? -Math.max(-1, Math.min(1, (c.lp - c.ema[24]) / (2 * s))) : 0; } },
  { id: 'fund_contra', nombre: 'Contra la euforia del funding', familia: 'funding', tipo: 'dir', fn: (c) => (c.nf < 24 ? 0 : c.fe24 * 8760 > 0.3 ? -1 : c.fe24 * 8760 < -0.1 ? 1 : 0) },
  { id: 'flujo_1h', nombre: 'Flujo de órdenes de la última hora', familia: 'flujo de órdenes', tipo: 'dir', flujo: true, fn: (c) => Math.sign(c.ofiH || 0) },
  { id: 'flujo_4h', nombre: 'Flujo de órdenes de 4 horas', familia: 'flujo de órdenes', tipo: 'dir', flujo: true, fn: (c) => Math.sign(c.ofiE4 || 0) },
  { id: 'flujo_cuarto', nombre: 'Flujo al empezar cada cuarto de hora', familia: 'flujo de órdenes', tipo: 'dir', flujo: true, fn: (c) => Math.sign(c.ofiQE || 0) },
  { id: 'libro', nombre: 'Desequilibrio del libro de órdenes', familia: 'flujo de órdenes', tipo: 'dir', flujo: true, fn: (c) => Math.sign(c.deseqE || 0) },
  { id: 'carry', nombre: 'Cobrar el funding (BTC y ETH)', familia: 'funding', tipo: 'carry', base: true },
  { id: 'carry_alt', nombre: 'Cobrar el funding rotando (funding > 10 %)', familia: 'funding', tipo: 'carry', umbral: 0.1 },
  { id: 'copiar_mejores', nombre: 'Copiar a las carteras con habilidad', familia: 'los mejores', tipo: 'copia', habilidad: true },
  { id: 'copiar_ranking', nombre: 'Copiar al ranking (sin filtrar suerte)', familia: 'los mejores', tipo: 'copia', habilidad: false },
  { id: 'ml_qlib', nombre: 'Aprendizaje automático (compra las 5 mejores y vende las 5 peores)', familia: 'aprendizaje automático', tipo: 'ml' },
  { id: 'btc_hold', nombre: 'Comprar y mantener Bitcoin', familia: 'referencia', tipo: 'hold' },
  { id: 'efectivo', nombre: 'Quedarse en efectivo', familia: 'referencia', tipo: 'cash' },
];

// Expertos del laboratorio (rendir-IEC/radar-laboratorio): estrategias con parámetros que el servidor sabe calcular con su
// memoria. Solo se aceptan valores de una lista cerrada; nunca se ejecuta código que venga de fuera.
const LAB_URL = 'https://raw.githubusercontent.com/rendir-IEC/radar-laboratorio/main/resultados/estrategias.json';
const LAB_MAX = 6;
const LAB_CADA_H = 6;
const LAB_PESO_PRUEBA = 0.1;      // candidata no aprobada: entra con el 10 % del peso medio y sin reparto fijo: solo sube si gana (0 = solo observar)
const LAB_MAX_BYTES = 262144;
// Señal diaria del aprendizaje automático (laboratorio, lab/senal.py): una cartera {moneda: peso} que el experto ml_qlib
// copia tal cual. Entra como candidata (10 % del peso medio, sin reparto fijo): solo sube si gana en vivo.
const ML_URL = 'https://raw.githubusercontent.com/rendir-IEC/radar-laboratorio/main/resultados/ml/senal.json';
const ML_CADA_H = 3;              // la señal es diaria: se mira cada 3 horas, en el minuto :37
const ML_MAX_BYTES = 65536;
const ML_PESO_MAX = 0.2;          // como mucho un 20 % del dinero por moneda
const ML_DIAS_VALIDA = 3;         // si el laboratorio deja de publicar, a los 3 días el experto se queda sin posición     // el archivo del laboratorio pesa ~16 KB; uno mucho mayor no se lee
function apListaExpertos(E) {
  const lab = (E && E.lab && E.lab.specs) || [];
  if (!lab.length) return AP_EXPERTOS;
  return AP_EXPERTOS.concat(lab.map((s) => ({ id: s.id, nombre: 'Laboratorio: ' + s.nombre, familia: 'laboratorio', tipo: 'lab', spec: s.spec, aprobadaLab: !!s.aprobada })));
}
function apLabValida(sp) {
  if (!sp || typeof sp !== 'object') return false;
  const senales = ['cruce', 'impulso', 'rebote', 'funding_contra', 'funding_sigue', 'tendencia_mixta'];
  if (!senales.includes(sp.senal)) return false;
  if (sp.senal === 'tendencia_mixta') { if (sp.a !== 12 || sp.b !== 720) return false; }
  else if (sp.senal.startsWith('funding')) { if (![24, 168].includes(sp.a)) return false; }
  else if (!AP.SPANS.includes(sp.a)) return false;
  if (sp.senal === 'cruce' && !(AP.SPANS.includes(sp.b) && sp.b > sp.a)) return false;
  if (!['signo', 'continua'].includes(sp.forma)) return false;
  if (sp.forma === 'continua' && !(typeof sp.k === 'number' && sp.k > 0 && sp.k <= 10)) return false;
  return ['serie', 'seccion'].includes(sp.modo) && ['ambos', 'largos', 'cortos'].includes(sp.lado) &&
    ['ninguno', 'btc_alcista', 'btc_bajista'].includes(sp.filtro) && [1, 24].includes(sp.cada);
}
function apLabNombre(sp) {
  const dur = { 12: '12 h', 24: '1 día', 72: '3 días', 168: '1 semana', 336: '2 semanas', 720: '1 mes' };
  const base = sp.senal === 'tendencia_mixta' ? 'Tendencia mixta (4 horizontes, de 12 h a 1 mes)'
    : sp.senal === 'cruce' ? 'Tendencia ' + dur[sp.a] + ' / ' + dur[sp.b]
    : sp.senal === 'impulso' ? 'Impulso de ' + dur[sp.a]
    : sp.senal === 'rebote' ? 'Rebote de ' + dur[sp.a]
    : sp.senal === 'funding_contra' ? 'Contra el funding (' + dur[sp.a] + ')' : 'A favor del funding (' + dur[sp.a] + ')';
  const extra = [];
  if (sp.modo === 'seccion') extra.push('relativa entre monedas');
  if (sp.lado !== 'ambos') extra.push('solo ' + (sp.lado === 'largos' ? 'compras' : 'ventas'));
  if (sp.filtro !== 'ninguno') extra.push(sp.filtro === 'btc_alcista' ? 'si BTC sube' : 'si BTC baja');
  if (sp.forma !== 'signo') extra.push('graduada');
  if (sp.cada === 24) extra.push('reajuste diario');
  return base + (extra.length ? ' (' + extra.join(', ') + ')' : '');
}
// identificador de una estrategia, igual que senales.ident() del laboratorio: el id no puede llevar texto libre
function apLabIdent(sp) {
  const p = [sp.senal, String(sp.a)];
  if (sp.b != null) p.push(String(sp.b));
  p.push(sp.forma === 'signo' ? 's' : 'c' + String(sp.k));
  p.push(sp.modo.slice(0, 3), sp.lado.slice(0, 3), { ninguno: 'nf', btc_alcista: 'ba', btc_bajista: 'bb' }[sp.filtro], 'h' + sp.cada);
  return p.join('_');
}
function apLabBruto(sp, c) {
  const sig = c.v2 > 0 ? Math.sqrt(c.v2) : 0;
  if (sp.senal.startsWith('funding')) {
    if (!(c.nf > 0)) return NaN;
    const x = (sp.a === 24 ? c.fe24 : c.fe168) * 8760 / 0.3;
    return sp.senal === 'funding_contra' ? -x : x;
  }
  if (!(sig > 0)) return NaN;
  if (sp.senal === 'tendencia_mixta') return [[12, 72], [24, 168], [72, 336], [168, 720]].reduce((a, [x, y]) => a + Math.sign(c.ema[x] - c.ema[y]), 0) / 4;
  if (sp.senal === 'cruce') return (c.ema[sp.a] - c.ema[sp.b]) / (sig * Math.sqrt(sp.b));
  const d = (c.lp - c.ema[sp.a]) / (sig * Math.sqrt(sp.a));
  return sp.senal === 'impulso' ? d : -d;
}
function apLabPosiciones(E, ex, listas, t) {
  const sp = ex.spec;
  if (sp.cada > 1 && E.expertos[ex.id] && Math.floor(t / 3600e3) % sp.cada !== 0) return null; // se mantiene sin coste
  const xs = {};
  for (const m of listas) { const x = apLabBruto(sp, E.monedas[m]); if (Number.isFinite(x)) xs[m] = x; }
  const ms = Object.keys(xs);
  const pos = {};
  if (sp.modo === 'seccion') {
    if (ms.length < 4) return pos;
    const media = ms.reduce((a, m) => a + xs[m], 0) / ms.length;
    for (const m of ms) xs[m] -= media;
  }
  let activo = true;
  if (sp.filtro !== 'ninguno') {
    const b = E.monedas.BTC;
    if (!b || b.n < AP.HORAS_MIN || !listas.includes('BTC')) activo = false;
    else { const alcista = b.ema[168] - b.ema[720] > 0; activo = sp.filtro === 'btc_alcista' ? alcista : !alcista; }
  }
  if (!activo) return pos;
  for (const m of ms) {
    let s = sp.forma === 'signo' ? Math.sign(xs[m]) : Math.max(-1, Math.min(1, xs[m] / sp.k));
    if (sp.lado === 'largos') s = Math.max(0, s); else if (sp.lado === 'cortos') s = Math.min(0, s);
    if (s) pos[m] = apEscala(E.monedas[m], s, ms.length);
  }
  return pos;
}
// Una vez cada 6 horas (en vivo) mira si el laboratorio ha publicado resultados nuevos. Usa 1 petición.
async function apLab(E) {
  if (E.labIntento && Date.now() - E.labIntento < LAB_CADA_H * 3600e3) return false;
  E.labIntento = Date.now();
  let j;
  try {
    const r = await fetch(LAB_URL, { headers: { 'User-Agent': 'radar-mercados/' + VERSION } });
    if (!r.ok) return false;
    if (Number(r.headers && r.headers.get && r.headers.get('content-length')) > LAB_MAX_BYTES) { console.log('laboratorio: archivo de más de ' + LAB_MAX_BYTES + ' bytes: no se lee'); return false; }
    const txt = await r.text();
    if (txt.length > LAB_MAX_BYTES) { console.log('laboratorio: ' + txt.length + ' caracteres, más de ' + LAB_MAX_BYTES + ': no se lee'); return false; }
    j = JSON.parse(txt);
  } catch (e) { return false; }
  if (!j || !Array.isArray(j.estrategias) || !Array.isArray(j.para_el_servidor)) return false;
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(String(v)) ? String(v) : '');
  const gen = String(j.generado || '').slice(0, 64); // para saber si es nuevo; no se muestra
  if (E.lab && (E.lab.genCrudo != null ? E.lab.genCrudo : E.lab.generado) === gen) return false;
  const porId = new Map(j.estrategias.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, x]));
  const specs = [];
  for (const id of [...new Set(j.para_el_servidor)].slice(0, LAB_MAX)) { // sin repetidos
    const x = porId.get(id);
    if (!x || !apLabValida(x.spec) || id !== 'lab_' + apLabIdent(x.spec) || AP_EXPERTOS.some((ex) => ex.id === id)) continue;
    const sp = x.spec;
    specs.push({ id, nombre: apLabNombre(sp), aprobada: x.aprobada === true,
      sharpeLab: Number(x.sharpe_anual) || 0, dsrLab: Number(x.sharpe_deflactado) || 0,
      spec: { senal: sp.senal, a: sp.a, b: sp.b, forma: sp.forma, k: sp.k, modo: sp.modo, lado: sp.lado, filtro: sp.filtro, cada: sp.cada } });
  }
  const antes = new Set(((E.lab && E.lab.specs) || []).map((x) => x.id));
  const ahora = new Set(specs.map((x) => x.id));
  const salen = [...antes].filter((id) => !ahora.has(id));
  for (const id of salen) { delete E.expertos[id]; delete E.lw[id]; }
  const nuevos = specs.filter((x) => !antes.has(x.id));
  const fos = j.procedimiento_fuera_de_muestra || {};
  const corto = (r) => (r && typeof r === 'object' ? { rentAnualPct: Number(r.rent_anual_pct) || 0, sharpeAnual: Number(r.sharpe_anual) || 0, caidaMaxPct: Number(r.caida_max_pct) || 0, dias: Number(r.dias) || 0 } : null);
  const pr = j.pruebas || {};
  E.lab = {
    generado: fecha(gen), genCrudo: gen, specs,
    estado: !specs.length ? 'sin propuestas' : specs.every((x) => x.aprobada) ? 'aprobadas en el laboratorio' : specs.some((x) => x.aprobada) ? 'aprobadas y candidatas en prueba' : 'candidatas en prueba (ninguna pasa la prueba contra la suerte)',
    periodo: j.periodo ? { desde: fecha(j.periodo.desde), hasta: fecha(j.periodo.hasta) } : null,
    probadas: Number(pr.estrategias_probadas) || 0, aprobadas: Number(pr.aprobadas) || 0, sobreajuste: Number(pr.probabilidad_sobreajuste),
    suerte: Number(pr.sharpe_anual_que_daria_la_suerte) || 0, fueraDeMuestra: corto(fos.top5), btc: corto(fos.comprar_y_mantener_btc),
  };
  if (nuevos.length) apAlerta(E, E.t, 'laboratorio', nuevos.map((x) => x.id).join(','), 'Llegan del laboratorio: ' + nuevos.map((x) => x.nombre).join('; ') + (specs.some((x) => x.aprobada) ? '' : ' (en prueba: ninguna pasó aún la prueba contra la suerte)'));
  if (salen.length) apAlerta(E, E.t, 'laboratorio', salen.join(','), 'Dejan de competir (el laboratorio ya no las propone): ' + salen.length);
  return true;
}

// Cada 3 horas (en vivo, minuto :37) lee la señal diaria del aprendizaje automático. Usa 1 petición. Solo acepta monedas
// del servidor y pesos acotados; nunca ejecuta nada que venga de fuera.
async function apMl(E) {
  E.mlIntento = Date.now();
  let j;
  try {
    const r = await fetch(ML_URL, { headers: { 'User-Agent': 'radar-mercados/' + VERSION } });
    if (!r.ok) return false;
    if (Number(r.headers && r.headers.get && r.headers.get('content-length')) > ML_MAX_BYTES) return false;
    const txt = await r.text();
    if (txt.length > ML_MAX_BYTES) return false;
    j = JSON.parse(txt);
  } catch (e) { return false; }
  if (!j || typeof j !== 'object' || !j.cartera || typeof j.cartera !== 'object' || Array.isArray(j.cartera)) return false;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(j.fecha)) ? String(j.fecha) : null;
  if (!fecha || !Number.isFinite(Date.parse(fecha + 'T00:00:00Z'))) return false;
  const gen = String(j.generado || '').slice(0, 64);
  if (E.ml && E.ml.fecha === fecha && E.ml.gen === gen) return false;
  const pos = {};
  let bruta = 0;
  for (const m of AP.MONEDAS) { // lista cerrada: solo monedas que el servidor conoce
    const x = Number(j.cartera[m]);
    if (!Number.isFinite(x) || x === 0 || Math.abs(x) > ML_PESO_MAX) continue;
    pos[m] = x; bruta += Math.abs(x);
  }
  if (!Object.keys(pos).length || bruta > 1 + 1e-9) return false;
  const antes = E.ml && E.ml.pos ? JSON.stringify(Object.entries(E.ml.pos).sort()) : '';
  const compradas = Object.keys(pos).filter((m) => pos[m] > 0).sort(), vendidas = Object.keys(pos).filter((m) => pos[m] < 0).sort();
  E.ml = { fecha, gen, pos, compradas, vendidas, leida: Date.now() };
  if (JSON.stringify(Object.entries(pos).sort()) !== antes) apAlerta(E, E.t, 'ml', fecha, 'Aprendizaje automático (cierre del ' + fecha + '): compra ' + (compradas.join(', ') || 'nada') + '; vende ' + (vendidas.join(', ') || 'nada') + ' (en papel; no es una recomendación)');
  return true;
}

function apEstadoNuevo() {
  return { v: 1, t: null, horas: 0, monedas: {}, carteras: {}, expertos: {}, lw: {}, sistema: apStats(), btcLog: 0, alertas: [], posSistema: {}, senal: {} };
}
function apStats() { return { n: 0, s1: 0, s2: 0, s3: 0, s4: 0, log: 0, maxLog: 0, dd: 0 }; }
function apSuma(st, r) {
  st.n++; st.s1 += r; st.s2 += r * r; st.s3 += r * r * r; st.s4 += r * r * r * r;
  st.log += Math.log(1 + Math.max(r, -0.99));
  if (st.log > st.maxLog) st.maxLog = st.log;
  const dd = 1 - Math.exp(st.log - st.maxLog);
  if (dd > st.dd) st.dd = dd;
}
function apMoneda() { const ema = {}; for (const s of AP.SPANS) ema[s] = null; return { lp: null, px: null, ema, v2: null, f: 0, fe24: 0, fe168: 0, nf: 0, n: 0, t: null }; }

// Una hora nueva. snap = { t: ms, px: {COIN: precio}, f: {COIN: funding horario}, carteras: {addr: {av, pos: {COIN: szi}}} }
function apPaso(E, snap) {
  const horas = E.t == null ? 1 : Math.max(1, Math.round((snap.t - E.t) / 3600e3));
  if (E.t != null && snap.t <= E.t) return E;
  E._silencio = !!snap.historia;
  // si otra versión sin horas por moneda (p. ej. la v2.1.2, al volver atrás) avanzó E.t, las monedas que estaban al día lo siguen
  if (E.tHoras != null && E.t != null && E.tHoras !== E.t) for (const c of Object.values(E.monedas)) { if (c.t != null && c.t >= E.tHoras) c.t = E.t; if (c.tf != null && c.tf >= E.tHoras) c.tf = E.t; }
  if ((E.v || 1) < 2) { for (const X of Object.values(E.expertos)) X.ascendido = false; E.v = 2; } // los ascensos pasan a medirse solo en vivo
  const EXPERTOS = apListaExpertos(E);
  // 1) resultado de la hora que acaba para cada experto
  const ret = {};
  for (const m of AP.MONEDAS) {
    const c = E.monedas[m];
    const p = snap.px[m];
    ret[m] = c && c.px && p ? p / c.px - 1 : 0;
  }
  // funding de la hora que acaba: en el repaso, el liquidado al final de esa hora (snap.f); en vivo, el que daba
  // Hyperliquid al empezarla (no hay otro sin pedir 20 historiales más)
  const fHora = (m) => { if (snap.historia && snap.f && Number.isFinite(snap.f[m])) return snap.f[m]; const c = E.monedas[m]; return c ? c.f : 0; };
  let rSistema = 0, pesoTotal = 0;
  const pesos = apPesos(E);
  for (const ex of EXPERTOS) {
    const X = E.expertos[ex.id];
    if (!X || !X.activo) continue;
    let r = 0;
    if (ex.tipo === 'carry') {
      for (const m of Object.keys(X.pos)) r += X.pos[m] * AP.PARTE_CARRY * fHora(m) * horas;
    } else if (ex.tipo !== 'cash') {
      for (const m of Object.keys(X.pos)) r += X.pos[m] * ((ret[m] || 0) - fHora(m) * horas);
    }
    const coste = X.coste || 0;
    r -= coste;
    X.coste = 0;
    apSuma(X.st, r);
    if (!snap.historia) apSuma(X.vivo || (X.vivo = apStats()), r);
    X.ultima = r;
    const w = pesos[ex.id] || 0;
    // el sistema suma el resultado bruto de cada experto y paga aparte el coste de mover SU cartera combinada (abajo)
    rSistema += w * (r + coste); pesoTotal += w;
  }
  rSistema -= E.costeSis || 0;
  E.costeSis = 0;
  if (E.t != null && pesoTotal > 0) {
    apSuma(E.sistema, rSistema); E.btcLog += Math.log(1 + (ret.BTC || 0));
    if (!snap.historia) {
      if (E.inicioVivo == null) E.inicioVivo = E.t;
      apSuma(E.vivo || (E.vivo = apStats()), rSistema); E.btcVivo = (E.btcVivo || 0) + Math.log(1 + (ret.BTC || 0));
    }
  }
  // 2) memoria del mercado
  for (const m of AP.MONEDAS) {
    const p = snap.px[m];
    if (!(p > 0)) continue;
    const c = E.monedas[m] || (E.monedas[m] = apMoneda());
    const lp = Math.log(p);
    // horas desde el último precio de ESTA moneda (si le faltó alguna hora, no se cuentan como una sola)
    const hm = c.t != null ? Math.max(1, Math.round((snap.t - c.t) / 3600e3)) : c.lp != null ? horas : 1;
    if (c.lp != null) { const lr = (lp - c.lp) / Math.sqrt(hm); c.v2 = c.v2 == null ? lr * lr : c.v2 + (1 - Math.pow(1 - 2 / 169, hm)) * (lr * lr - c.v2); }
    for (const s of AP.SPANS) { const a = 1 - Math.pow(1 - 2 / (s + 1), hm); c.ema[s] = c.ema[s] == null ? lp : c.ema[s] + a * (lp - c.ema[s]); }
    c.lp = lp; c.px = p; c.n += hm;
    const f = snap.f ? snap.f[m] : null;
    if (f != null && Number.isFinite(f)) {
      const hf = c.tf != null ? Math.max(1, Math.round((snap.t - c.tf) / 3600e3)) : c.nf > 0 ? horas : 1;
      c.f = f; c.nf += hf;
      c.fe24 = c.nf <= hf ? f : c.fe24 + (1 - Math.pow(1 - 2 / 25, hf)) * (f - c.fe24);
      c.fe168 = c.nf <= hf ? f : c.fe168 + (1 - Math.pow(1 - 2 / 169, hf)) * (f - c.fe168);
      c.tf = snap.t;
    }
    c.t = snap.t;
    // flujo de órdenes de la hora que acaba (solo en vivo): media móvil de unas 4 horas
    if (snap.flujo) {
      const fl = snap.flujo[m];
      const a = 2 / 5;
      if (fl && fl.n > 0) {
        const primero = !c.nflujo;
        c.ofiH = fl.ofi;
        c.ofiE4 = primero ? fl.ofi : c.ofiE4 + a * (fl.ofi - c.ofiE4);
        c.ofiQE = primero ? fl.ofiQ : c.ofiQE + a * (fl.ofiQ - c.ofiQE);
        c.deseqE = primero ? fl.deseq : c.deseqE + a * (fl.deseq - c.deseqE);
        c.nflujo = (c.nflujo || 0) + 1;
      } else if (c.nflujo) {
        c.ofiH = 0; c.ofiE4 *= 1 - a; c.ofiQE *= 1 - a; c.deseqE *= 1 - a;
      }
    }
  }
  // carteras seguidas: rentabilidad de su hora y habilidad aprendida
  if (snap.carteras) {
    for (const [addr, d] of Object.entries(snap.carteras)) {
      const W = E.carteras[addr] || (E.carteras[addr] = { st: apStats(), pos: {}, av: null, desde: snap.t });
      if (W.av > 0 && snap.pxTodos) {
        let pnl = 0;
        for (const [m, szi] of Object.entries(W.pos)) { const a = W.px && W.px[m], b = snap.pxTodos[m]; if (a > 0 && b > 0) pnl += szi * (b - a); }
        apSuma(W.st, Math.max(-0.99, pnl / W.av));
      }
      W.av = d.av; W.pos = d.pos || {};
      W.px = {};
      if (snap.pxTodos) for (const m of Object.keys(W.pos)) W.px[m] = snap.pxTodos[m];
    }
  }
  // 3) pesos: multiplicativos según lo ganado, con reparto fijo para poder cambiar de opinión
  const activos = EXPERTOS.filter((ex) => E.expertos[ex.id] && E.expertos[ex.id].activo);
  if (activos.length) {
    for (const ex of activos) { const X = E.expertos[ex.id]; E.lw[ex.id] = (E.lw[ex.id] || 0) + AP.ETA * Math.log(1 + Math.max(X.ultima || 0, -0.99)); }
    const w = apPesos(E);
    const M = activos.length;
    // las candidatas en prueba no reciben el reparto fijo (si no, se acercarían al peso medio sin ganar a nadie)
    for (const ex of activos) E.lw[ex.id] = Math.log((1 - AP.REPARTO) * w[ex.id] + ((ex.tipo === 'lab' && !ex.aprobadaLab) || ex.tipo === 'ml' ? 1e-12 : AP.REPARTO / M));
    const maxLw = Math.max(...activos.map((ex) => E.lw[ex.id]));
    for (const ex of activos) E.lw[ex.id] -= maxLw;
  }
  // 4) posiciones nuevas de cada experto (y activar los que ya tienen datos suficientes)
  const listas = AP.MONEDAS.filter((m) => E.monedas[m] && E.monedas[m].n >= 720 && snap.px[m] > 0);
  const habilidad = apHabilidades(E);
  for (const ex of EXPERTOS) {
    let X = E.expertos[ex.id];
    const nueva = apPosiciones(E, ex, listas, habilidad, snap.t);
    if (!nueva) continue;
    if (!X) {
      X = E.expertos[ex.id] = { activo: true, desde: snap.t, st: apStats(), pos: {}, coste: 0, ultima: 0 };
      const vals = Object.values(E.lw);
      E.lw[ex.id] = vals.length ? Math.log(vals.reduce((a, b) => a + Math.exp(b), 0) / vals.length) : 0;
      if ((ex.tipo === 'lab' && !ex.aprobadaLab) || ex.tipo === 'ml') E.lw[ex.id] += Math.log(Math.max(LAB_PESO_PRUEBA, 1e-9));
      apAlerta(E, snap.t, 'nuevo', ex.id, 'Empieza a aprender: ' + ex.nombre);
    }
    // banda sin operar: si la posición solo cambia un poco (menos del 25 %), se deja como estaba y no se pagan comisiones
    if (ex.tipo === 'dir' || ex.tipo === 'copia' || ex.tipo === 'lab') {
      const objetivo = { ...nueva };
      for (const m of Object.keys(nueva)) { const o = X.pos[m]; if (o && Math.sign(o) === Math.sign(nueva[m]) && Math.abs(nueva[m] - o) < AP.BANDA * Math.abs(o)) nueva[m] = o; }
      // la banda no puede dejar la exposición bruta por encima del 100 % (p. ej. al entrar mercados nuevos)
      if (Object.values(nueva).reduce((a, b) => a + Math.abs(b), 0) > 1 + 1e-9) Object.assign(nueva, objetivo);
    }
    X.coste = ex.tipo === 'carry' ? apCosteCarry(apGiro(nueva, X.pos)) : apGiro(nueva, X.pos) * AP.COMISION;
    X.pos = nueva;
  }
  // posición combinada del sistema (para avisar y para el panel)
  const w2 = apPesos(E);
  const comb = {};
  for (const ex of EXPERTOS) {
    const X = E.expertos[ex.id];
    if (!X || !X.activo || ex.tipo === 'carry') continue;
    for (const [m, p] of Object.entries(X.pos)) comb[m] = (comb[m] || 0) + (w2[ex.id] || 0) * p;
  }
  let carry = 0;
  const combC = {};
  for (const ex of EXPERTOS) if (ex.tipo === 'carry' && E.expertos[ex.id]) for (const [m, p] of Object.entries(E.expertos[ex.id].pos)) { combC[m] = (combC[m] || 0) + (w2[ex.id] || 0) * p; carry += (w2[ex.id] || 0) * p; }
  // coste de pasar de la cartera combinada anterior a esta (lo que pagaría quien la siguiera); se cobra en la hora siguiente.
  // Incluye los cambios de peso entre expertos, que antes no se cobraban, y descuenta lo que se compensa entre ellos.
  if (!E.carryPos) E.carryPos = combC;
  E.costeSis = apGiro(comb, E.posSistema || {}) * AP.COMISION + apCosteCarry(apGiro(combC, E.carryPos));
  E.carryPos = combC;
  // aviso solo al cruzar umbrales con histéresis: entra a partir del 5 % del dinero y sale por debajo del 1 %
  E.senal = E.senal || {};
  for (const m of AP.MONEDAS) {
    const v = comb[m] || 0;
    const antes = E.senal[m] || 0;
    const ahora = v >= 0.05 ? 1 : v <= -0.05 ? -1 : Math.abs(v) < 0.01 ? 0 : antes;
    if (ahora !== antes && E.horas > 0) apAlerta(E, snap.t, 'senal', m, m + ': la cartera en papel pasa a ' + (ahora > 0 ? 'comprar' : ahora < 0 ? 'vender' : 'no tener') + ' (' + (v * 100).toFixed(1) + ' % del dinero; no es una recomendación)');
    E.senal[m] = ahora;
  }
  E.posSistema = comb; E.carrySistema = carry;
  // ascensos: el experto supera la prueba contra la suerte
  const informe = !snap.historia || E.horas % 24 === 0 ? apInforme(E) : [];
  for (const r of informe) {
    const X = E.expertos[r.id];
    if (!X) continue;
    const antes = X.ascendido || false;
    X.ascendido = r.estado === 'ascendida';
    if (X.ascendido && !antes) apAlerta(E, snap.t, 'ascenso', r.id, 'Asciende en papel: ' + r.nombre + ' (Sharpe deflactado ' + r.dsr.toFixed(2) + ' con ' + r.horasVivo + ' h en vivo; no garantiza resultados futuros)');
    if (!X.ascendido && antes) apAlerta(E, snap.t, 'descenso', r.id, 'Pierde el ascenso: ' + r.nombre);
  }
  E.t = snap.t; E.tHoras = snap.t; E.horas += E.horas === 0 ? 1 : horas;
  delete E._silencio;
  return E;
}

function apPesos(E) {
  const ids = apListaExpertos(E).map((ex) => ex.id).filter((id) => E.expertos[id] && E.expertos[id].activo && E.lw[id] != null);
  const s = ids.reduce((a, id) => a + Math.exp(E.lw[id]), 0);
  const out = {};
  for (const id of ids) out[id] = s > 0 ? Math.exp(E.lw[id]) / s : 0;
  return out;
}

function apHabilidades(E) {
  const out = {};
  for (const [addr, W] of Object.entries(E.carteras)) {
    const st = W.st;
    if (st.n < 24) { out[addr] = { habilidad: 0, t: 0, n: st.n }; continue; }
    const m = st.s1 / st.n, v = Math.max(st.s2 / st.n - m * m, 1e-12);
    const t = (m / Math.sqrt(v)) * Math.sqrt(st.n);
    out[addr] = { habilidad: Math.max(0, 2 * apPhi(t) - 1) * (t > 0 ? 1 : 0), t, n: st.n };
  }
  return out;
}

function apPosiciones(E, ex, listas, habilidad, t) {
  const pos = {};
  if (ex.tipo === 'cash') return pos;
  if (ex.tipo === 'lab') return listas.length ? apLabPosiciones(E, ex, listas, t) : null;
  if (ex.tipo === 'ml') {
    const M = E.ml;
    if (!M || !M.pos) return null;
    // fecha = día del cierre usado (el cierre es a las 00:00 UTC del día siguiente)
    const edad = t - (Date.parse(M.fecha + 'T00:00:00Z') + 86400e3);
    if (!(edad >= 0) || edad > ML_DIAS_VALIDA * 86400e3) return E.expertos[ex.id] ? {} : null; // caducada: sin posición
    for (const m of listas) if (M.pos[m]) pos[m] = M.pos[m];
    return pos;
  }
  if (ex.tipo === 'hold') { if (!E.monedas.BTC || !E.monedas.BTC.px) return null; pos.BTC = 1; return pos; }
  if (ex.tipo === 'carry') {
    const cands = ex.base ? AP.CARRY_BASE : AP.MONEDAS;
    const conF = cands.filter((m) => E.monedas[m] && E.monedas[m].nf >= 168);
    if (!conF.length) return null;
    const dentro = conF.filter((m) => (ex.base ? E.monedas[m].fe168 > 0 : E.monedas[m].fe168 * 8760 > ex.umbral && E.monedas[m].fe24 > 0));
    for (const m of dentro) pos[m] = 1 / (ex.base ? cands.length : Math.max(3, dentro.length));
    return pos;
  }
  if (ex.tipo === 'copia') {
    const cart = Object.entries(E.carteras).filter(([, W]) => W.av > 0 && W.st.n >= 24);
    if (cart.length < 3 || !listas.length) return null;
    let total = 0;
    const suma = {};
    for (const [addr, W] of cart) {
      const peso = ex.habilidad ? habilidad[addr].habilidad : 1;
      if (!(peso > 0)) continue;
      total += peso;
      for (const m of listas) {
        const szi = W.pos[m];
        if (!szi) continue;
        const exp = (szi * E.monedas[m].px) / W.av;
        suma[m] = (suma[m] || 0) + peso * Math.max(-1, Math.min(1, exp));
      }
    }
    for (const m of listas) {
      const s = total > 0 ? (suma[m] || 0) / total : 0;
      const sig = Math.max(-1, Math.min(1, s * 3));
      if (Math.abs(sig) > 0.05) pos[m] = apEscala(E.monedas[m], sig, listas.length);
    }
    return pos;
  }
  if (!listas.length) return null;
  if (ex.flujo) {
    const conFlujo = listas.filter((m) => (E.monedas[m].nflujo || 0) >= AP.HORAS_FLUJO);
    if (!conFlujo.length) return null;
    for (const m of conFlujo) { const s = ex.fn(E.monedas[m]); if (s) pos[m] = apEscala(E.monedas[m], s, conFlujo.length); }
    return pos;
  }
  for (const m of listas) {
    const c = E.monedas[m];
    if (ex.id === 'fund_contra' && c.nf < 24) continue;
    const s = ex.fn(c);
    if (s) pos[m] = apEscala(c, s, listas.length);
  }
  if (ex.id === 'fund_contra' && !listas.some((m) => E.monedas[m].nf >= 24)) return null;
  return pos;
}

function apEscala(c, s, n) {
  const vol = c.v2 > 0 ? Math.sqrt(c.v2) : AP.VOL_OBJ_H;
  return (s * Math.min(1, AP.VOL_OBJ_H / vol)) / n;
}
// suma de |cambio| de posición entre dos carteras {moneda: fracción del dinero}
function apGiro(a, b) { let g = 0; for (const m of new Set([...Object.keys(a), ...Object.keys(b)])) g += Math.abs((a[m] || 0) - (b[m] || 0)); return g; }
// coste de girar el cobro del funding (dos patas: contado y perpetuo). Ver el criterio de COSTE_CARRY en AP.
function apCosteCarry(giro) { return giro * AP.PARTE_CARRY * AP.COSTE_CARRY / 2; }

function apAlerta(E, t, tipo, ref, texto) {
  if (E._silencio) return;
  E.alertas.unshift({ t, tipo, ref, texto });
  if (E.alertas.length > AP.MAX_ALERTAS) E.alertas.length = AP.MAX_ALERTAS;
}

// Normal estándar: función de distribución e inversa (Acklam).
function apPhi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function apPhiInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155211218];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Momentos de una serie de rentabilidades horarias: Sharpe horario, asimetría y curtosis (no exceso).
function apMomentos(st) {
  const n = st.n;
  const m = n ? st.s1 / n : 0;
  const v = n ? Math.max(st.s2 / n - m * m, 0) : 0;
  const sd = Math.sqrt(v);
  return { n, sr: sd > 0 ? m / sd : 0, sk: sd > 0 ? (st.s3 / n - 3 * m * st.s2 / n + 2 * m * m * m) / (sd * sd * sd) : 0,
    ku: sd > 0 ? (st.s4 / n - 4 * m * st.s3 / n + 6 * m * m * st.s2 / n - 3 * m * m * m * m) / (v * v) : 3 };
}
// Informe por experto. Las columnas sin «Vivo» incluyen el repaso de la historia (simulación sobre los datos con los que se
// diseñaron los expertos). El Sharpe deflactado y los ascensos usan SOLO horas en vivo, y compiten solo los expertos que
// apuestan por el precio (tendencia, impulso, rebote, funding, flujo, copia): el cobro del funding, comprar y mantener y el
// efectivo son referencias (el cobro del funding se modela sin riesgo de precio y su Sharpe disparaba el umbral de todos).
function apInforme(E) {
  const pesos = apPesos(E);
  const tipo = Object.fromEntries(apListaExpertos(E).map((ex) => [ex.id, ex.tipo]));
  const compite = (id) => tipo[id] === 'dir' || tipo[id] === 'copia' || tipo[id] === 'lab' || tipo[id] === 'ml';
  const filas = [];
  for (const ex of apListaExpertos(E)) {
    const X = E.expertos[ex.id];
    if (!X) { filas.push({ id: ex.id, nombre: ex.nombre, familia: ex.familia, horas: 0, horasVivo: 0, estado: 'esperando datos' }); continue; }
    const st = X.st, sv = X.vivo || apStats();
    const a = apMomentos(st), b = apMomentos(sv);
    filas.push({ id: ex.id, nombre: ex.nombre, familia: ex.familia, horas: a.n, pesoPct: (pesos[ex.id] || 0) * 100, rentPct: (Math.exp(st.log) - 1) * 100,
      rentAnualPct: a.n ? (Math.exp((st.log / a.n) * 8760) - 1) * 100 : null, sharpeAnual: a.sr * Math.sqrt(8760), caidaMaxPct: st.dd * 100,
      horasVivo: b.n, rentVivoPct: (Math.exp(sv.log) - 1) * 100, sharpeVivoAnual: b.sr * Math.sqrt(8760), caidaMaxVivoPct: sv.dd * 100, _b: b });
  }
  const conDatos = filas.filter((f) => f.horasVivo > 24 && compite(f.id));
  const N = Math.max(conDatos.length, AP.PRUEBAS || 2, 2);
  const srs = conDatos.map((f) => f._b.sr);
  const ms = srs.reduce((a, b) => a + b, 0) / Math.max(srs.length, 1);
  const V = srs.length > 1 ? srs.reduce((a, b) => a + (b - ms) * (b - ms), 0) / (srs.length - 1) : 0;
  const g = 0.5772156649;
  const sr0 = Math.sqrt(V) * ((1 - g) * apPhiInv(1 - 1 / N) + g * apPhiInv(1 - 1 / (N * Math.E)));
  for (const f of filas) {
    if (!f.horas) { delete f._b; f.dsr = 0; f.estado = f.estado || (compite(f.id) ? 'aprendiendo' : 'referencia'); continue; }
    const { n, sr, sk, ku } = f._b;
    const den = Math.sqrt(Math.max(1e-12, 1 - sk * sr + ((ku - 1) / 4) * sr * sr));
    f.dsr = n > 24 && compite(f.id) ? apPhi(((sr - sr0) * Math.sqrt(n - 1)) / den) : 0;
    f.estado = !compite(f.id) ? 'referencia' : n < AP.HORAS_MIN ? 'aprendiendo' : f.dsr > 0.95 && sr > 0 ? 'ascendida' : sr <= 0 ? 'descartada por ahora' : 'en observación';
    delete f._b;
  }
  return filas;
}

// ---------- sistema que aprende: memoria en D1, reloj cada minuto ----------
// 30 carteras públicas del ranking de Hyperliquid (24-nov-2026): cuenta > 200.000 $, más de 250.000 $ ganados en total,
// en positivo este mes y esta semana, volumen real (sin creadores de mercado). El sistema aprende cuáles tienen habilidad.
const CARTERAS_SEGUIDAS = [
  '0xb695651daa495f59dd2725c6fe98322d8b51a92d', '0x0b8aa35c28b7c6ab18f11dc168f437a8a69fd4f8', '0x218a65e21eddeece7a9df38c6bbdd89f692b7da2',
  '0x3dc908374e11623d8eb9f07dfc7a2e5e803a54b0', '0xfe7ce058edc7cfcde9ef8262ba51f8d4796ab7ae', '0xca4903c207a0df58bf37d4bc8bbc5210726f53c8',
  '0x15a4f009bb324a3fb9e36137136b201e3fe0dfdb', '0xf818fa41af44a1b42ba7433f4ec472be40a2c268', '0x484bc1608211d0604bf70bae72792a56884562f8',
  '0x4ba3979955f52158c0e4e3378b18985475182ce2', '0xecc846a664e910103c179827dd23fea82cfcd8ce', '0xba5d9cc840745aeeeeedac5712e32f13ab8ea352',
  '0xd47587702a91731dc1089b5db0932cf820151a91', '0x64a4fbb71858f681f3fa10a42b34180a9a48088d', '0x77375a8c9d13bf79afb2a87f1b0ac1dfd5f5bf66',
  '0xdfd526409007db0d524a62dedaaba7706736d88e', '0xd4c1f7e8d876c4749228d515473d36f919583d1d', '0xfb1898bb5955fdd11704e397104c6a0e0725eb17',
  '0xb37f083bad343a76361cd8f39afe7ecd6a0a66ca', '0xbfc79c444c41a74516bf31237ebf586a231480b4', '0x6859da14835424957a1e6b397d8026b1d9ff7e1e',
  '0x0a776abbaae0e2161d0e131f57e605efbea4b99b', '0x6df99d59cdada18ade521e05edd5e6a2ec91b734', '0xcac19662ec88d23fa1c81ac0e8570b0cf2ff26b3',
  '0xd1dd6d99c5fb5d31ff52eacce5046c7158859e85', '0x8cc94dc843e1ea7a19805e0cca43001123512b6a', '0xceec48581b3145a575508719f45da07dc57fa7ce',
  '0x418aa6bf98a2b2bc93779f810330d88cde488888', '0x936cf4fb95c30ce83f658b5bbb247e4bb381bb0f', '0xda26ab2a88881523ce002477fdee2f4ac9eb572a',
];
const AP_HORAS_HISTORIA = 5000;
const AP_LOTE = 16;
const H1 = 3600e3;
let apTablasListas = false;

async function apTablas(env) {
  if (apTablasListas) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ap_estado (id TEXT PRIMARY KEY, json TEXT NOT NULL, t INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ap_curva (t INTEGER PRIMARY KEY, s REAL, b REAL, n INTEGER)'),
  ]);
  apTablasListas = true;
}
async function apCargar(env) {
  await apTablas(env);
  const fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('principal').first();
  return fila ? JSON.parse(fila.json) : apEstadoNuevo();
}
async function apGuardar(env, E, curva) {
  const ops = [env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('principal', JSON.stringify(E), E.t)];
  for (const c of curva) ops.push(env.DB.prepare('INSERT OR REPLACE INTO ap_curva (t, s, b, n) VALUES (?1, ?2, ?3, ?4)').bind(c[0], c[1], c[2], c[3]));
  await env.DB.batch(ops);
}

// Un ciclo: si va atrasado, repasa la historia (24 horas por ciclo); si está al día, aprende la hora nueva en vivo.
async function apCiclo(env) {
  if (!env || !env.DB) return { ok: false, error: 'Falta conectar la base de datos D1 (variable DB).' };
  await apTablas(env);
  const ahora = Date.now();
  const horaActual = Math.floor(ahora / H1) * H1;
  const filaT = await env.DB.prepare('SELECT t FROM ap_estado WHERE id = ?1').bind('principal').first();
  const tGuardado = filaT ? filaT.t : null;
  if (tGuardado != null && tGuardado >= horaActual) return { ok: true, modo: 'al día', hasta: iso(tGuardado) };
  const E = await apCargar(env);
  const curva = [];
  if (E.t == null || E.t < horaActual - H1) {
    const desde = E.t == null ? horaActual - AP_HORAS_HISTORIA * H1 : E.t + H1;
    const hasta = Math.min(desde + (AP_LOTE - 1) * H1, horaActual - H1);
    const px = {}, fu = {}, fallidas = [];
    // Una moneda que falla (o que Hyperliquid ya no tiene) no debe parar el repaso entero; BTC sí es imprescindible.
    await Promise.all(AP.MONEDAS.map(async (m) => {
      px[m] = new Map(); fu[m] = new Map();
      try {
        const v = await hl({ type: 'candleSnapshot', req: { coin: m, interval: '1h', startTime: desde - H1, endTime: hasta - H1 } });
        px[m] = new Map((Array.isArray(v) ? v : []).map((k) => [Number(k.t) + H1, num(k.c)]));
        const f = await hl({ type: 'fundingHistory', coin: m, startTime: desde - H1, endTime: hasta + H1 - 1 });
        fu[m] = new Map((Array.isArray(f) ? f : []).map((x) => [Math.round(Number(x.time) / H1) * H1, num(x.fundingRate)]));
      } catch (e) { fallidas.push(m); }
    }));
    if (fallidas.length) {
      // ¿fallan porque ya no existen (se toleran) o por un error pasajero (se repite el lote entero al minuto siguiente)?
      const meta = await hl({ type: 'meta' });
      const hay = new Set(((meta && meta.universe) || []).filter((a) => !a.isDelisted).map((a) => a.name));
      const pasajeras = fallidas.filter((m) => hay.has(m) || m === 'BTC');
      if (pasajeras.length) throw new Error('repaso: fallan ' + pasajeras.join(','));
      console.log('repaso: fuera del dex principal ' + fallidas.join(','));
    }
    let hechas = 0;
    for (let t = desde; t <= hasta; t += H1) {
      const p = {}, f = {};
      for (const m of AP.MONEDAS) { const a = px[m].get(t); if (a > 0) p[m] = a; const b = fu[m].get(t); if (b != null) f[m] = b; }
      if (!p.BTC) continue;
      apPaso(E, { t, px: p, f, historia: true });
      curva.push([t, E.sistema.log, E.btcLog, E.sistema.n]);
      hechas++;
    }
    if (!hechas) E.t = hasta;
    await apGuardar(env, E, curva);
    return { ok: true, modo: 'repasando la historia', horas: hechas, hasta: iso(E.t), faltan: Math.round((horaActual - E.t) / H1) };
  }
  // en vivo (el laboratorio se lee aparte, en el minuto :37: apLabMinuto)
  const [meta, ctxs] = await hl({ type: 'metaAndAssetCtxs' });
  const p = {}, f = {}, todos = {}, enDex = new Set();
  (meta.universe || []).forEach((a, i) => {
    const c = ctxs[i];
    if (!c) return;
    const precio = num(c.markPx);
    if (precio > 0) todos[a.name] = precio;
    if (a.isDelisted) return; // precio congelado: no se aprende de él
    enDex.add(a.name);
    if (AP.MONEDAS.includes(a.name)) { if (precio > 0) p[a.name] = precio; const fr = num(c.funding); if (fr != null) f[a.name] = fr; }
  });
  // los mercados nuevos se calientan en otros minutos (apCalentarMinuto), no en este, que ya es el más cargado
  E.fueraDex = AP.MONEDAS.filter((m) => !enDex.has(m));
  const carteras = {};
  // un solo intento por cartera: con 30 carteras y 3 intentos, un 429 de Hyperliquid agota el límite de 50 subpeticiones
  const res = await Promise.allSettled(CARTERAS_SEGUIDAS.map((addr) => pedir(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'clearinghouseState', user: addr }) }, 1)));
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value || !r.value.marginSummary) return;
    const pos = {};
    for (const ap of r.value.assetPositions || []) { const q = ap && ap.position; if (q && num(q.szi)) pos[q.coin] = num(q.szi); }
    carteras[CARTERAS_SEGUIDAS[i]] = { av: num(r.value.marginSummary.accountValue), pos };
  });
  const flujo = await apFlujoDeLaHora(env, horaActual - H1);
  apPaso(E, { t: horaActual, px: p, f, carteras, pxTodos: todos, flujo });
  curva.push([horaActual, E.sistema.log, E.btcLog, E.sistema.n]);
  await apGuardar(env, E, curva);
  return { ok: true, modo: 'en vivo', hora: iso(horaActual), carteras: Object.keys(carteras).length };
}

// Lo que ve el panel.
// ---------- calentar mercados nuevos: cargan sus últimas 800 horas para entrar ya en el aprendizaje ----------
async function apCalentar(E, limite, enDex) {
  if (E.t == null) return [];
  // por turnos: una moneda que no puede calentarse (p. ej. con menos de 720 h de historia) no bloquea a las demás
  const intentos = E.calentar || (E.calentar = {});
  const faltan = AP.MONEDAS.filter((m) => (!E.monedas[m] || E.monedas[m].n < AP.HORAS_MIN) && (!enDex || enDex.has(m)))
    .sort((a, b) => (intentos[a] || 0) - (intentos[b] || 0)).slice(0, limite);
  const hechos = [];
  for (const m of faltan) {
    intentos[m] = E.t;
    try {
      const [v, fh] = await Promise.all([
        hl({ type: 'candleSnapshot', req: { coin: m, interval: '1h', startTime: E.t - 800 * H1, endTime: E.t } }),
        hl({ type: 'fundingHistory', coin: m, startTime: E.t - 200 * H1, endTime: E.t }),
      ]);
      const cierres = (Array.isArray(v) ? v : []).map((k) => [Number(k.t) + H1, num(k.c)]).filter((x) => x[0] <= E.t && x[1] > 0).sort((a, b) => a[0] - b[0]);
      if (cierres.length < AP.HORAS_MIN) continue;
      const c = apMoneda();
      for (const [, p] of cierres) {
        const lp = Math.log(p);
        if (c.lp != null) { const lr = lp - c.lp; c.v2 = c.v2 == null ? lr * lr : c.v2 + (2 / 169) * (lr * lr - c.v2); }
        for (const sp of AP.SPANS) c.ema[sp] = c.ema[sp] == null ? lp : c.ema[sp] + (2 / (sp + 1)) * (lp - c.ema[sp]);
        c.lp = lp; c.px = p; c.n++;
      }
      c.t = cierres[cierres.length - 1][0];
      const tasas = (Array.isArray(fh) ? fh : []).map((x) => [Number(x.time), num(x.fundingRate)]).filter((x) => x[1] != null).sort((a, b) => a[0] - b[0]);
      for (const [, r] of tasas) { c.f = r; c.nf++; c.fe24 = c.nf === 1 ? r : c.fe24 + (2 / 25) * (r - c.fe24); c.fe168 = c.nf === 1 ? r : c.fe168 + (2 / 169) * (r - c.fe168); }
      E.monedas[m] = c;
      delete intentos[m];
      hechos.push(m);
    } catch (e) { /* se reintenta la hora siguiente */ }
  }
  if (hechos.length) apAlerta(E, Math.floor(Date.now() / 60e3) * 60e3, 'mercados', hechos.join(','), 'Se incorporan al aprendizaje: ' + hechos.join(', ') + ' (con sus últimas 800 horas de memoria)');
  return hechos;
}

// Laboratorio: como mucho cada 6 h, en el minuto :37, lejos de la hora en vivo. Guarda solo si nadie ha escrito
// una hora nueva entretanto (mismo patrón que apCalentarMinuto). +1 petición.
async function apLabMinuto(env) {
  const E = await apCargar(env);
  const ahora = Date.now();
  const tocaLab = !(E.labIntento && ahora - E.labIntento < LAB_CADA_H * 3600e3);
  const tocaMl = !(E.mlIntento && ahora - E.mlIntento < ML_CADA_H * 3600e3);
  if (E.t == null || (!tocaLab && !tocaMl)) return { ok: true, modo: 'nada que leer' };
  const tAntes = E.t;
  const cambio = tocaLab ? await apLab(E) : false;
  if (tocaMl) await apMl(E);
  await env.DB.prepare('UPDATE ap_estado SET json = ?1 WHERE id = ?2 AND t = ?3').bind(JSON.stringify(E), 'principal', tAntes).run();
  return { ok: true, modo: 'laboratorio', cambio };
}

// Calienta 1 mercado en un minuto sin hora en vivo (CPU y peticiones aparte). Escribe solo si nadie ha guardado otra hora entretanto.
async function apCalentarMinuto(env) {
  const E = await apCargar(env);
  if (E.t == null) return { ok: true, modo: 'nada que calentar' };
  const fuera = new Set(E.fueraDex || []);
  if (!AP.MONEDAS.some((m) => (!E.monedas[m] || E.monedas[m].n < AP.HORAS_MIN) && !fuera.has(m))) return { ok: true, modo: 'nada que calentar' };
  const tAntes = E.t;
  const hechos = await apCalentar(E, 1, { has: (m) => !fuera.has(m) });
  await env.DB.prepare('UPDATE ap_estado SET json = ?1 WHERE id = ?2 AND t = ?3').bind(JSON.stringify(E), 'principal', tAntes).run();
  return { ok: true, modo: 'calentar', hechos };
}

// ---------- flujo de órdenes: cada minuto, del libro de órdenes de Hyperliquid ----------
// Mide quién empuja más, compradores o vendedores, con los cambios del mejor precio de compra y de venta entre
// dos lecturas (desequilibrio del flujo de órdenes de Cont, Kukanov y Stoikov) y el desequilibrio de las 10 mejores posiciones del libro.
// Guarda la suma de la hora y la de los dos primeros minutos de cada cuarto de hora.
async function apMinuto(env) {
  const ahora = Date.now();
  const horaActual = Math.floor(ahora / H1) * H1;
  const filaT = await env.DB.prepare('SELECT t FROM ap_estado WHERE id = ?1').bind('principal').first();
  if (!filaT || filaT.t < horaActual - H1) return { ok: true, modo: 'sin flujo durante el repaso' };
  const fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('flujo').first();
  const F = fila ? JSON.parse(fila.json) : { abierta: null, cerrada: null, prev: {} };
  if (!F.abierta || F.abierta.hora !== horaActual) { if (F.abierta) F.cerrada = F.abierta; F.abierta = { hora: horaActual, monedas: {} }; }
  const minuto = Math.floor((ahora - horaActual) / 60e3);
  const inicioCuarto = minuto % 15 < 2;
  const libros = await Promise.allSettled(AP.MONEDAS.map((m) => pedir(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin: m }) }, 1)));
  libros.forEach((r, i) => {
    const m = AP.MONEDAS[i];
    const lv = r.status === 'fulfilled' && r.value && r.value.levels;
    if (!Array.isArray(lv) || !lv[0] || !lv[1] || !lv[0].length || !lv[1].length) return;
    const compras = lv[0], ventas = lv[1];
    const pc = num(compras[0].px), qc = num(compras[0].sz), pv = num(ventas[0].px), qv = num(ventas[0].sz);
    let sc = 0, sv = 0;
    for (let k = 0; k < Math.min(10, compras.length); k++) sc += num(compras[k].sz);
    for (let k = 0; k < Math.min(10, ventas.length); k++) sv += num(ventas[k].sz);
    const deseq = sc + sv > 0 ? (sc - sv) / (sc + sv) : 0;
    const p = F.prev[m];
    let ofi = 0;
    if (p && ahora - p.t < 5 * 60e3) {
      const e = (pc >= p.pc ? qc : 0) - (pc <= p.pc ? p.qc : 0) - (pv <= p.pv ? qv : 0) + (pv >= p.pv ? p.qv : 0);
      const prof = (p.qc + p.qv + qc + qv) / 4;
      ofi = prof > 0 ? Math.max(-5, Math.min(5, e / prof)) : 0;
    }
    F.prev[m] = { t: ahora, pc, qc, pv, qv };
    const a = F.abierta.monedas[m] || (F.abierta.monedas[m] = { ofi: 0, ofiQ: 0, deseq: 0, n: 0 });
    a.ofi += ofi; if (inicioCuarto) a.ofiQ += ofi; a.deseq += deseq; a.n++;
  });
  await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('flujo', JSON.stringify(F), ahora).run();
  return { ok: true, modo: 'flujo', minuto };
}
async function apFlujoDeLaHora(env, hora) {
  const fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('flujo').first();
  if (!fila) return null;
  const F = JSON.parse(fila.json);
  const cubo = [F.abierta, F.cerrada].find((x) => x && x.hora === hora);
  if (!cubo) return null;
  const out = {};
  for (const [m, a] of Object.entries(cubo.monedas)) if (a.n > 0) out[m] = { ofi: a.ofi, ofiQ: a.ofiQ, deseq: a.deseq / a.n, n: a.n };
  return out;
}

// ---------- bot de pruebas (v2.3): ¿cuánto se ganaría con 50, 200 o 1000 € siguiendo al sistema en Kraken Futuros? ----------
// En papel. Kraken tiene licencia MiCA (cripto) y MiFID (derivados) en el EEE: es donde operar sería legal en España.
// Cada hora (minuto :07) cada cartera copia la posición combinada del sistema (sin el cobro del funding, que necesita
// contado) con lo que pasaría de verdad: múltiplos del tamaño mínimo de cada contrato, comisión de toma, la mitad del
// diferencial de ese momento y el funding de Kraken. Sin apalancamiento: la exposición bruta no pasa del dinero que hay.
const KF = 'https://futures.kraken.com/derivatives/api/v3';
const BOT = {
  CAPITALES: [50, 200, 1000],  // euros
  COMISION: 0.0005,            // toma en Kraken Futuros, nivel 1 (www.kraken.com/pro/fees, tabla del 9-7-2026)
  BANDA: 0.25,                 // como el sistema: si la posición solo cambia un poco, no se opera
  MINUTO: 7,
  MINUTO_FICHAS: 27,           // fichas de los contratos (tamaño mínimo), una vez al día y en otro minuto
  MAX_CURVA: 400,
};
const KR_ALIAS = { XBT: 'BTC', XDG: 'DOGE' };
// La tasa «absoluta» del ticker (dólares por contrato y hora) entre el precio = tasa relativa por hora. Comprobado con el
// laboratorio el 25-11-2026 (resultados/kraken): coincide con la última relativeFundingRate publicada (cociente 1,000–1,003
// en las 20 monedas). Kraken cobra el funding cada hora; positivo: el comprado paga.
const KR_FUNDING = (f, p) => f / p;

// 'PF_XBTUSD' -> ['BTC', 1]; 'PF_1000PEPEUSD' -> ['PEPE', 1000]; null si no es un perpetuo lineal en dólares
function krBase(simbolo) {
  if (typeof simbolo !== 'string' || !simbolo.startsWith('PF_') || !simbolo.endsWith('USD')) return null;
  let b = simbolo.slice(3, -3), mult = 1;
  for (const m of [1000000, 1000]) { const s = String(m); if (b.startsWith(s) && b.length > s.length) { b = b.slice(s.length); mult = m; break; } }
  return [KR_ALIAS[b] || b, mult];
}
// cantidad en múltiplos del tamaño mínimo (10^-prec), hacia cero
const botMultiplo = (q, prec) => { const k = Math.pow(10, prec); return Number((Math.trunc(q * k + (q > 0 ? 1e-9 : -1e-9)) / k).toFixed(Math.max(0, prec))); };
// 'kPEPE' -> 'PEPE' (en Hyperliquid la k indica lotes de mil)
const hlBase = (coin) => (coin.length > 1 && coin[0] === 'k' && coin.slice(1) === coin.slice(1).toUpperCase() ? coin.slice(1) : coin);
// Tasa de funding por hora, relativa al precio, a partir del ticker de Kraken (comprobado en el laboratorio: KR_FUNDING)
const krRelativa = (tk) => { const f = num(tk.fundingRate), p = num(tk.markPrice); return f != null && p > 0 ? KR_FUNDING(f, p) : 0; };

function botNuevo() { return { v: 1, fichas: null, carteras: {}, eurUsd: null }; }
function botCartera(eur, usd, t) {
  return { eur, usd0: eur * usd, t0: t, t: t, valor: eur * usd, pos: {}, px: {}, comision: 0, diferencial: 0, funding: 0, operaciones: 0, max: eur * usd, dd: 0, curva: [], sis0: null };
}
async function botCargar(env) {
  await apTablas(env);
  const f = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('bot').first();
  return f ? JSON.parse(f.json) : botNuevo();
}
async function botGuardar(env, B) {
  await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('bot', JSON.stringify(B), Date.now()).run();
}

// Fichas de los contratos de Kraken Futuros para las monedas del sistema (1 petición, una vez al día).
async function botFichas(env) {
  const B = await botCargar(env);
  if (B.fichas && Date.now() - B.fichas.t < 20 * H1) return { ok: true, modo: 'fichas al día' };
  const j = await pedir(KF + '/instruments', {}, 2);
  const por = {};
  for (const i of (j && j.instruments) || []) {
    const b = krBase(i.symbol);
    if (!b || i.tradeable === false) continue;
    const coin = AP.MONEDAS.find((m) => hlBase(m) === b[0]);
    if (!coin || (por[coin] && por[coin].mult <= b[1])) continue;
    const prec = num(i.contractValueTradePrecision);
    por[coin] = { sym: i.symbol, mult: b[1], prec: prec != null && Number.isFinite(prec) ? prec : 0 };
  }
  if (!Object.keys(por).length) throw new Error('Kraken Futuros no devolvió contratos');
  B.fichas = { t: Date.now(), monedas: por };
  await botGuardar(env, B);
  return { ok: true, modo: 'fichas', monedas: Object.keys(por).length };
}

// Una hora de una cartera: cobra lo que hicieron sus posiciones y el funding, y se ajusta a la posición del sistema.
// px: {moneda: {mark, bid, ask, rel}} de Kraken. objetivo: {moneda: fracción del dinero} (posición combinada del sistema).
function botPaso(C, px, objetivo, fichas, t, horas) {
  // 1) resultado de la hora: precio y funding (positivo: el comprado paga)
  let res = 0, fun = 0;
  for (const [m, q] of Object.entries(C.pos)) {
    const p = px[m];
    if (!p || !(p.mark > 0) || !(C.px[m] > 0)) continue;
    res += q * (p.mark - C.px[m]);
    fun += q * p.mark * (p.rel || 0) * horas;
  }
  C.valor += res - fun;
  C.funding += fun;
  for (const m of Object.keys(C.pos)) if (px[m] && px[m].mark > 0) C.px[m] = px[m].mark;
  if (!(C.valor > 0)) { C.valor = Math.max(C.valor, 0); C.pos = {}; C.t = t; return; } // sin dinero no se opera
  // 2) posiciones nuevas, en múltiplos del tamaño mínimo y sin pasar del dinero que hay
  const nueva = {};
  let bruta = 0;
  for (const m of Object.keys(fichas)) {
    const p = px[m];
    const w = objetivo[m] || 0;
    if (!p || !(p.mark > 0) || !w) continue;
    let q = botMultiplo((w * C.valor) / p.mark, fichas[m].prec);
    const o = C.pos[m] || 0;
    if (o && q && Math.sign(o) === Math.sign(q) && Math.abs(q - o) < BOT.BANDA * Math.abs(o)) q = o; // banda sin operar
    if (q) { nueva[m] = q; bruta += Math.abs(q) * p.mark; }
  }
  const tope = C.valor * (1 - 2 * BOT.COMISION); // deja sitio a los costes de la propia operación
  if (bruta > tope) { const k = tope / bruta; for (const m of Object.keys(nueva)) { const q = botMultiplo(nueva[m] * k, fichas[m].prec); if (q) nueva[m] = q; else delete nueva[m]; } }
  // 3) costes de lo que se mueve: comisión de toma y la mitad del diferencial del momento
  let com = 0, dif = 0, ops = 0;
  for (const m of new Set([...Object.keys(nueva), ...Object.keys(C.pos)])) {
    const d = Math.abs((nueva[m] || 0) - (C.pos[m] || 0));
    if (!(d > 0)) continue;
    const p = px[m];
    if (!p || !(p.mark > 0)) { if (nueva[m] == null && C.pos[m]) nueva[m] = C.pos[m]; continue; } // sin precio no se toca
    com += d * p.mark * BOT.COMISION;
    dif += p.ask > p.bid && p.bid > 0 ? d * (p.ask - p.bid) / 2 : 0;
    ops++;
    C.px[m] = p.mark;
  }
  C.valor -= com + dif;
  C.comision += com; C.diferencial += dif; C.operaciones += ops;
  C.pos = nueva;
  for (const m of Object.keys(C.px)) if (!C.pos[m]) delete C.px[m];
  C.max = Math.max(C.max, C.valor);
  C.dd = Math.max(C.dd, C.max > 0 ? 1 - C.valor / C.max : 0);
  C.t = t;
}

async function botHora(env) {
  const B = await botCargar(env);
  if (!B.fichas) return { ok: true, modo: 'esperando las fichas de Kraken' };
  const horaActual = Math.floor(Date.now() / H1) * H1;
  if (Object.values(B.carteras).some((C) => C.t >= horaActual)) return { ok: true, modo: 'ya hecho' };
  const E = await apCargar(env);
  // la posición del sistema tiene que ser la de esta hora; si aún no está, se vuelve a intentar el minuto siguiente
  if (E.t == null || E.t < horaActual) return { ok: true, modo: 'esperando la hora del sistema' };
  const [tk, eur] = await Promise.all([pedir(KF + '/tickers', {}, 2), kraken('Ticker?pair=EURUSD').catch(() => null)]);
  const porSym = new Map(((tk && tk.tickers) || []).map((x) => [x.symbol, x]));
  const px = {};
  for (const [m, f] of Object.entries(B.fichas.monedas)) {
    const x = porSym.get(f.sym);
    if (!x || x.suspended) continue;
    px[m] = { mark: num(x.markPrice), bid: num(x.bid), ask: num(x.ask), rel: krRelativa(x) };
  }
  if (!Object.keys(px).length) throw new Error('Kraken Futuros sin precios');
  if (eur) { const k = Object.keys(eur)[0]; const c = k && eur[k] && num(eur[k].c && eur[k].c[0]); if (c > 0) B.eurUsd = c; }
  const eurUsd = B.eurUsd || 1.1;
  const objetivo = E.posSistema || {};
  for (const cap of BOT.CAPITALES) {
    const id = String(cap);
    let C = B.carteras[id];
    if (!C) { C = B.carteras[id] = botCartera(cap, eurUsd, horaActual); C.sis0 = E.sistema.log; }
    const horas = Math.max(1, Math.round((horaActual - C.t) / H1));
    botPaso(C, px, objetivo, B.fichas.monedas, horaActual, C.t === horaActual ? 0 : horas);
    C.sis = E.sistema.log;
    if (horaActual % (24 * H1) === 0 || !C.curva.length) { C.curva.push([horaActual, Math.round(C.valor * 100) / 100]); if (C.curva.length > BOT.MAX_CURVA) C.curva.splice(0, C.curva.length - BOT.MAX_CURVA); }
  }
  await botGuardar(env, B);
  return { ok: true, modo: 'bot', hora: iso(horaActual) };
}

async function botVista(env) {
  const B = await botCargar(env);
  const eurUsd = B.eurUsd || 1.1;
  const rows = Object.values(B.carteras).sort((a, b) => a.eur - b.eur).map((C) => ({
    // el capital se aporta en euros (garantía en EUR): el cambio euro/dólar solo afecta a la ganancia, no al capital
    capitalEur: C.eur, valorEur: C.eur + (C.valor - C.usd0) / eurUsd, gananciaEur: (C.valor - C.usd0) / eurUsd, gananciaPct: (C.valor / C.usd0 - 1) * 100,
    sistemaIdealPct: C.sis != null && C.sis0 != null ? (Math.exp(C.sis - C.sis0) - 1) * 100 : null,
    desde: iso(C.t0), horas: Math.round((C.t - C.t0) / H1), operaciones: C.operaciones,
    comisionesEur: C.comision / eurUsd, diferencialEur: C.diferencial / eurUsd, fundingEur: C.funding / eurUsd, caidaMaxPct: C.dd * 100,
    posiciones: Object.entries(C.pos).map(([m, q]) => ({ moneda: m, contrato: B.fichas && B.fichas.monedas[m] ? B.fichas.monedas[m].sym : null, cantidad: q, valorEur: (q * (C.px[m] || 0)) / eurUsd })),
    curva: C.curva.map(([t, v]) => ({ fecha: fechaDe(t), valorEur: C.eur + (v - C.usd0) / eurUsd })),
  }));
  return { rows, eurUsd, nota: 'Bot de pruebas en papel: tres carteras (50, 200 y 1000 €) que siguen cada hora la posición del sistema en Kraken Futuros con sus reglas reales: múltiplos del tamaño mínimo de cada contrato, comisión de toma del ' + (BOT.COMISION * 100).toFixed(2) + ' %, la mitad del diferencial del momento y el funding de Kraken, sin apalancamiento. No incluye el cobro del funding del sistema (necesita contado). sistemaIdealPct es lo que hizo el sistema en el mismo tiempo sin mínimos ni diferencial. No mueve dinero ni es una recomendación.' };
}

async function aprendizaje({ vista } = {}, env) {
  if (!env || !env.DB) throw new Error('Falta conectar la base de datos D1 (variable DB) al Worker.');
  const E = await apCargar(env);
  const v = vista || 'resumen';
  if (v === 'bot') return botVista(env);
  if (v === 'ml') {
    const M = E.ml;
    const r = apInforme(E).find((x) => x.id === 'ml_qlib') || {};
    if (!M) return { rows: [], nota: 'Aún no ha llegado la señal del aprendizaje automático (se mira cada ' + ML_CADA_H + ' horas, en el minuto :37).' };
    return { rows: Object.entries(M.pos).sort((a, b) => b[1] - a[1]).map(([m, w]) => ({ moneda: m, lado: w > 0 ? 'comprar' : 'vender', pesoPct: w * 100 })),
      senal: { cierre: M.fecha, leida: M.leida ? iso(M.leida) : null, caduca: iso(Date.parse(M.fecha + 'T00:00:00Z') + (1 + ML_DIAS_VALIDA) * 86400e3) },
      experto: { pesoPct: r.pesoPct || 0, horasEnVivo: r.horasVivo || 0, rentEnVivoPct: r.rentVivoPct == null ? null : r.rentVivoPct, estado: r.estado || 'esperando datos' },
      nota: 'Señal diaria del laboratorio: un modelo LightGBM (indicadores de Qlib) ordena las 20 monedas de más volumen y se compran las 5 mejores y se venden las 5 peores entre las del servidor (10 % del dinero cada una). En la prueba de 2022 a 2026: +21 % al año de media, caídas del 37 % y 2026 en negativo. Entra con el ' + Math.round(LAB_PESO_PRUEBA * 100) + ' % del peso medio y solo sube si gana en vivo. En papel; no es una recomendación.' };
  }
  const pct = (log) => (Math.exp(log) - 1) * 100;
  if (v === 'expertos') return { rows: apInforme(E), nota: 'Peso: cuánto confía hoy el sistema en cada experto. rentPct, sharpeAnual y caidaMaxPct incluyen el repaso de la historia, una simulación sobre los mismos datos con los que se diseñaron los expertos: no demuestran nada. Las columnas «Vivo» cuentan solo horas en vivo. Sharpe deflactado (solo en vivo): probabilidad estimada de que el Sharpe real sea positivo, corrigiendo por al menos ' + AP.PRUEBAS + ' pruebas; supone horas independientes. Asciende con más de 0,95 y al menos 720 horas en vivo («aprendiendo» hasta entonces). Cobro del funding, comprar y mantener y efectivo son referencias: el cobro del funding se modela sin riesgo de precio.' };
  if (v === 'posiciones') {
    const rows = AP.MONEDAS.map((m) => { const x = (E.posSistema || {})[m] || 0; const s = (E.senal || {})[m] || 0; return { moneda: m, posicionPct: x * 100, senal: s > 0 ? 'comprar' : s < 0 ? 'vender' : 'nada', precio: E.monedas[m] ? E.monedas[m].px : null }; });
    rows.push({ moneda: 'Cobro del funding', posicionPct: (E.carrySistema || 0) * 100, senal: (E.carrySistema || 0) > 0.05 ? 'mantener' : 'nada', precio: null });
    return { rows, hora: E.t ? iso(E.t) : null, nota: 'Posición combinada del sistema en papel, en % del dinero. Positivo: comprado; negativo: vendido. Exposición direccional como mucho del 100 % del dinero; el cobro del funding usa 2/3 en contado y un corto de perpetuo del mismo tamaño con 1/3 de margen (2x en esa pata). No es una recomendación de inversión.' };
  }
  if (v === 'curva') {
    const filas = await env.DB.prepare('SELECT t, s, b, n FROM ap_curva WHERE n > 0 AND (t % 86400000) = 0 ORDER BY t').all();
    const datos = filas.results || [];
    const s0 = datos.length ? datos[0].s : 0, b0 = datos.length ? datos[0].b : 0;
    const tVivo = Math.min(...[E.inicioVivo, ...Object.values(E.carteras || {}).map((W) => W.desde)].filter((x) => x != null));
    return { rows: datos.map((r) => ({ fecha: fechaDe(r.t), sistemaPct: pct(r.s - s0), btcPct: pct(r.b - b0), tramo: r.t > tVivo ? 'en vivo' : 'repaso de la historia' })), nota: 'Valor de 1 € en el sistema y en Bitcoin desde el primer día (00:00 UTC de cada día). El tramo «repaso de la historia» es una simulación sobre los datos con los que se diseñaron los expertos; solo el tramo «en vivo» es aprendizaje en papel de verdad. Costes: comisiones de 0,045 % y funding; sin diferencial ni deslizamiento.' };
  }
  if (v === 'carteras') {
    const hab = apHabilidades(E);
    const rows = Object.entries(E.carteras).map(([addr, W]) => ({ cartera: addr.slice(0, 6) + '…' + addr.slice(-4), direccion: addr, horas: W.st.n, rentPct: pct(W.st.log), t: hab[addr] ? hab[addr].t : 0, habilidadPct: hab[addr] ? hab[addr].habilidad * 100 : 0, posiciones: Object.keys(W.pos || {}).length }));
    rows.sort((a, b) => b.habilidadPct - a.habilidadPct || b.t - a.t);
    return { rows, nota: 'Rentabilidad estimada hora a hora desde que se siguen (solo por el precio de sus posiciones, sin funding ni operaciones dentro de la hora). Habilidad: indicador de 0 a 100 basado en la prueba t de esa rentabilidad. No es la probabilidad de que no sea suerte: no corrige por haber elegido 30 carteras del ranking de ganadoras ni por la autocorrelación. Hacen falta al menos 24 horas.' };
  }
  if (v === 'alertas') return { rows: (E.alertas || []).map((a) => ({ hora: iso(a.t), tipo: a.tipo, texto: a.texto })) };
  if (v === 'laboratorio') {
    const L = E.lab;
    if (!L) return { rows: [], nota: 'Aún no ha llegado nada del laboratorio (se consulta cada 6 horas cuando el sistema está al día).' };
    const vivo = new Map(apInforme(E).filter((r) => r.familia === 'laboratorio').map((r) => [r.id, r]));
    const rows = L.specs.map((x) => { const r = vivo.get(x.id) || {}; return { id: x.id, nombre: x.nombre, aprobadaEnLaboratorio: x.aprobada, sharpeLaboratorio: x.sharpeLab, deflactadoLaboratorio: x.dsrLab, horasEnVivo: r.horasVivo || 0, pesoPct: r.pesoPct || 0, rentEnVivoPct: r.rentVivoPct == null ? null : r.rentVivoPct, estadoEnVivo: r.estado || 'esperando datos' }; });
    return { rows, laboratorio: { generado: L.generado, periodo: L.periodo, estrategiasProbadas: L.probadas, aprobadas: L.aprobadas, probabilidadSobreajuste: L.sobreajuste, sharpeQueDariaLaSuerte: L.suerte, fueraDeMuestraTop5: L.fueraDeMuestra, btcMismoPeriodo: L.btc, estado: L.estado },
      nota: 'Estrategias que el laboratorio propone tras probar miles en años de historia. Las aprobadas (pasan la prueba contra la suerte) entran con el peso medio; las candidatas en prueba, con el ' + Math.round(LAB_PESO_PRUEBA * 100) + ' % del peso medio. Después, su peso lo deciden sus resultados en vivo. En papel.' };
  }
  const inf = apInforme(E);
  const mejor = inf.filter((r) => r.horas).sort((a, b) => (b.pesoPct || 0) - (a.pesoPct || 0))[0];
  const st = E.sistema;
  return {
    rows: [{
      horasAprendidas: E.horas, hasta: E.t ? iso(E.t) : null, modo: E.t != null && E.t >= Math.floor(Date.now() / H1) * H1 - H1 ? 'en vivo' : 'repasando la historia',
      horasOperando: st.n, sistemaPct: pct(st.log), btcPct: pct(E.btcLog), caidaMaxPct: st.dd * 100,
      horasEnVivo: E.vivo ? E.vivo.n : 0, sistemaVivoPct: E.vivo ? pct(E.vivo.log) : 0, btcVivoPct: pct(E.btcVivo || 0), caidaMaxVivoPct: E.vivo ? E.vivo.dd * 100 : 0,
      enVivoDesde: E.inicioVivo != null ? iso(E.inicioVivo) : null,
      expertos: inf.filter((r) => r.horas).length, ascendidos: inf.filter((r) => r.estado === 'ascendida').length,
      mejorExperto: mejor ? mejor.nombre : null, pesoMejorPct: mejor ? mejor.pesoPct : null, carterasSeguidas: Object.keys(E.carteras).length,
    }],
    nota: 'Todo en papel: el sistema no mueve dinero. sistemaPct y btcPct incluyen el repaso de la historia (una simulación sobre los datos con los que se diseñaron los expertos, que no demuestra nada); lo que cuenta es sistemaVivoPct, solo horas en vivo. Costes: 0,045 % sobre cada cambio de la cartera combinada, y funding; sin diferencial ni deslizamiento. mejorExperto es el que más peso tiene hoy, no uno probado.',
  };
}

// ---------- resolución de símbolos ----------
async function resolver(simbolo) {
  const s = String(simbolo || '').trim().toUpperCase();
  if (!s) throw new Error('Falta el símbolo.');
  const def = CATALOGO[s];
  if (def && !def.xyz) return { simbolo: s, nombre: def.nombre, grupo: def.grupo, clase: 'cripto', kraken: def.kraken, hl: def.hl, binance: def.binance };
  const universo = await xyzUniverso();
  const porNombre = new Map(universo.map((c) => [sinDex(c), c]));
  if (def) {
    const coin = def.xyz.map((x) => porNombre.get(x)).find(Boolean);
    if (!coin) throw new Error(s + ': trade.xyz no tiene ahora ninguno de estos mercados: ' + def.xyz.join(', ') + '.');
    return { simbolo: s, nombre: def.nombre, grupo: def.grupo, clase: 'xyz', coin };
  }
  const directo = porNombre.get(sinDex(s));
  if (directo) return { simbolo: s, nombre: sinDex(s), grupo: 'acciones y otros (EE. UU.)', clase: 'xyz', coin: directo };
  if (/^[A-Z0-9]{2,10}$/.test(s)) return { simbolo: s, nombre: s, grupo: 'cripto', clase: 'cripto', hl: s, binance: s + 'USDT' };
  throw new Error('Símbolo desconocido: ' + s + '. Usa la herramienta mercados para ver la lista.');
}
const FUENTE = { xyz: 'Hyperliquid (trade.xyz)', hl: 'Hyperliquid', binance: 'Binance', kraken: 'Kraken' };
const TIPO = { xyz: 'aproximación (perpetuo)', cripto: 'mercado real' };

// ---------- herramientas ----------
async function precios({ simbolos } = {}) {
  const lista = (Array.isArray(simbolos) && simbolos.length ? simbolos : LISTA_DEFECTO).slice(0, 40);
  const resueltos = await Promise.all(lista.map((s) => resolver(s).catch((e) => ({ simbolo: String(s).toUpperCase(), error: e.message }))));
  const ok = resueltos.filter((r) => !r.error);
  const cripto = ok.filter((r) => r.clase === 'cripto');
  const errores = resueltos.filter((r) => r.error).map((r) => ({ simbolo: r.simbolo, error: r.error }));
  let ctx = null, bin = null, kr = null, hlm = null;
  const fallos = [];
  const tareas = [];
  if (ok.some((r) => r.clase === 'xyz')) tareas.push(xyzContextos().then((m) => { ctx = m; }).catch((e) => errores.push({ simbolo: 'xyz', error: e.message })));
  if (cripto.length) {
    tareas.push((async () => {
      const conKraken = cripto.filter((r) => r.kraken);
      if (conKraken.length) { try { kr = await krakenPrecios(conKraken.map((r) => r.kraken)); } catch (e) { fallos.push(e.message); } }
      const sinKraken = cripto.filter((r) => !(kr && r.kraken && kr.get(r.kraken)));
      if (sinKraken.some((r) => r.hl)) { try { hlm = await hlContextos(); } catch (e) { fallos.push(e.message); } }
      const sinHl = sinKraken.filter((r) => !(hlm && r.hl && hlm.get(r.hl)));
      if (sinHl.some((r) => r.binance)) { try { bin = await binancePrecios(sinHl.filter((r) => r.binance).map((r) => r.binance)); } catch (e) { fallos.push(e.message); } }
    })());
  }
  await Promise.all(tareas);
  const rows = [];
  for (const r of ok) {
    const base = { simbolo: r.simbolo, nombre: r.nombre, grupo: r.grupo };
    if (r.clase === 'xyz') {
      const c = ctx && ctx.get(r.coin);
      if (!c) { if (ctx) errores.push({ simbolo: r.simbolo, error: 'Sin datos de ' + r.coin }); continue; }
      const precio = num(c.midPx) ?? num(c.markPx);
      rows.push({ ...base, precio, cambioPct: pct(num(c.markPx), num(c.prevDayPx)), referencia: '24 h', oraculo: num(c.oraclePx), volumen24hUsd: num(c.dayNtlVlm), fuente: FUENTE.xyz, idFuente: r.coin, tipo: TIPO.xyz });
    } else {
      const k = kr && r.kraken && kr.get(r.kraken);
      if (k) { rows.push({ ...base, precio: k.precio, cambioPct: k.cambioPct, referencia: k.referencia, oraculo: null, volumen24hUsd: null, fuente: FUENTE.kraken, idFuente: r.kraken, tipo: TIPO.cripto }); continue; }
      const c = hlm && r.hl && hlm.get(r.hl);
      if (c) { rows.push({ ...base, precio: num(c.midPx) ?? num(c.markPx), cambioPct: pct(num(c.markPx), num(c.prevDayPx)), referencia: '24 h', oraculo: num(c.oraclePx), volumen24hUsd: num(c.dayNtlVlm), fuente: FUENTE.hl, idFuente: r.hl, tipo: TIPO.xyz }); continue; }
      const b = bin && bin.get(r.binance);
      if (b) { rows.push({ ...base, precio: b.precio, cambioPct: b.cambioPct, referencia: b.referencia, oraculo: null, volumen24hUsd: null, fuente: FUENTE.binance, idFuente: r.binance, tipo: TIPO.cripto }); continue; }
      errores.push({ simbolo: r.simbolo, error: 'Sin precio' + (fallos.length ? ': ' + fallos.join(' / ') : '') });
    }
  }
  return { rows, errores, generado: iso(Date.now()), nota: NOTA_XYZ };
}

async function velasDe(r, intervalo, n) {
  if (r.clase === 'xyz') return { velas: await xyzVelas(r.coin, intervalo, n), fuente: FUENTE.xyz, idFuente: r.coin, tipo: TIPO.xyz };
  const intentos = [];
  if (r.kraken) intentos.push(async () => ({ velas: await krakenVelas(r.kraken, intervalo, n), fuente: FUENTE.kraken, idFuente: r.kraken, tipo: TIPO.cripto }));
  if (r.hl) intentos.push(async () => ({ velas: await xyzVelas(r.hl, intervalo, n), fuente: FUENTE.hl, idFuente: r.hl, tipo: TIPO.xyz }));
  if (r.binance) intentos.push(async () => ({ velas: await binanceVelas(r.binance, intervalo, n), fuente: FUENTE.binance, idFuente: r.binance, tipo: TIPO.cripto }));
  const fallos = [];
  for (const f of intentos) {
    try { const d = await f(); if (d.velas.length) return d; fallos.push(d.fuente + ': sin velas'); } catch (e) { fallos.push(e.message); }
  }
  throw new Error('Sin velas de ' + r.simbolo + ': ' + fallos.join(' / '));
}
function validar(intervalo, n, max) {
  const iv = intervalo || '5m';
  if (!INTERVALOS[iv]) throw new Error('Intervalo no válido: usa ' + Object.keys(INTERVALOS).join(', '));
  const cuantas = Math.max(10, Math.min(max, Math.round(Number(n) || 120)));
  return [iv, cuantas];
}
async function velas({ simbolo, intervalo, n } = {}) {
  const [iv, cuantas] = validar(intervalo, n, 500);
  const r = await resolver(simbolo);
  const d = await velasDe(r, iv, cuantas);
  return { rows: d.velas.map((v) => ({ simbolo: r.simbolo, ...v })), simbolo: r.simbolo, nombre: r.nombre, intervalo: iv, fuente: d.fuente, idFuente: d.idFuente, tipo: d.tipo, nota: 'La última vela está en curso.' + (d.tipo === TIPO.xyz ? ' ' + NOTA_XYZ : '') };
}
async function velasLote({ simbolos, intervalo, n } = {}) {
  const [iv, cuantas] = validar(intervalo, n, 300);
  const lista = (Array.isArray(simbolos) && simbolos.length ? simbolos : LISTA_DEFECTO).slice(0, 20);
  const rows = [], errores = [], fuentes = [];
  await Promise.all(lista.map(async (s) => {
    try {
      const r = await resolver(s);
      const d = await velasDe(r, iv, cuantas);
      fuentes.push({ simbolo: r.simbolo, nombre: r.nombre, grupo: r.grupo, fuente: d.fuente, idFuente: d.idFuente, tipo: d.tipo });
      for (const v of d.velas) rows.push({ simbolo: r.simbolo, ...v });
    } catch (e) { errores.push({ simbolo: String(s).toUpperCase(), error: e.message }); }
  }));
  const orden = new Map(lista.map((s, i) => [String(s).toUpperCase(), i]));
  rows.sort((a, b) => orden.get(a.simbolo) - orden.get(b.simbolo) || (a.t < b.t ? -1 : 1));
  fuentes.sort((a, b) => orden.get(a.simbolo) - orden.get(b.simbolo));
  return { rows, fuentes, errores, intervalo: iv, nota: 'La última vela de cada símbolo está en curso. ' + NOTA_XYZ };
}
async function mercados() {
  const rows = [];
  let universo = [], errorXyz = null;
  try { universo = await xyzUniverso(); } catch (e) { errorXyz = e.message; }
  const porNombre = new Map(universo.map((c) => [sinDex(c), c]));
  const usados = new Set();
  for (const [s, d] of Object.entries(CATALOGO)) {
    if (d.xyz) {
      const coin = d.xyz.map((x) => porNombre.get(x)).find(Boolean) || null;
      if (coin) usados.add(coin);
      rows.push({ simbolo: s, nombre: d.nombre, grupo: d.grupo, fuente: FUENTE.xyz, idFuente: coin, disponible: !!coin, tipo: TIPO.xyz });
    } else {
      rows.push({ simbolo: s, nombre: d.nombre, grupo: d.grupo, fuente: d.kraken ? FUENTE.kraken + ' (respaldo Hyperliquid)' : FUENTE.hl, idFuente: d.kraken || d.hl, disponible: true, tipo: d.kraken ? TIPO.cripto : TIPO.xyz });
    }
  }
  const otrosXyz = universo.filter((c) => !usados.has(c)).map(sinDex).sort();
  return { rows, otrosXyz, errorXyz, nota: 'Cualquier nombre de otrosXyz (por ejemplo una acción de EE. UU.) se puede pedir tal cual en precios y velas.' };
}
async function estadoFuentes() {
  const prueba = async (fuente, fn) => {
    const t0 = Date.now();
    try { const detalle = await fn(); return { fuente, ok: true, ms: Date.now() - t0, detalle }; }
    catch (e) { return { fuente, ok: false, ms: Date.now() - t0, detalle: e.message }; }
  };
  const rows = await Promise.all([
    prueba(FUENTE.xyz, async () => { const u = await xyzUniverso(); return u.length + ' mercados en el dex xyz'; }),
    prueba(FUENTE.binance, async () => { const t = await pedir(BINANCE + '/time'); return 'hora del servidor ' + iso(t.serverTime); }),
    prueba(FUENTE.kraken, async () => { const t = await kraken('Time'); return 'hora del servidor ' + iso(t.unixtime * 1000); }),
  ]);
  return { rows, version: VERSION, generado: iso(Date.now()) };
}

const S_SIMBOLOS = { type: 'array', items: { type: 'string' }, description: 'Símbolos, p. ej. ["BTC","ORO","SP500","EURUSD","NVDA"]. Vacío: la lista por defecto.' };
const S_INTERVALO = { type: 'string', enum: Object.keys(INTERVALOS), description: 'Duración de cada vela. Por defecto 5m.' };
const HERRAMIENTAS = [
  { name: 'precios', title: 'Precios ahora', description: 'Precio actual y cambio de cripto (mercado real), oro, plata, petróleo, S&P 500, Nasdaq 100 aprox., divisas y acciones de EE. UU. (aproximación por perpetuos de trade.xyz). Una fila por símbolo, con la fuente y el tipo de precio.', inputSchema: { type: 'object', properties: { simbolos: S_SIMBOLOS }, additionalProperties: false }, fn: precios },
  { name: 'velas', title: 'Velas de un activo', description: 'Velas OHLCV recientes de un símbolo (1m, 5m, 15m, 1h, 4h o 1d). Una fila por vela, la última en curso.', inputSchema: { type: 'object', properties: { simbolo: { type: 'string', description: 'p. ej. BTC, ORO, WTI, SP500, EURUSD o un ticker de EE. UU.' }, intervalo: S_INTERVALO, n: { type: 'integer', minimum: 10, maximum: 500, description: 'Número de velas (por defecto 120).' } }, required: ['simbolo'], additionalProperties: false }, fn: velas },
  { name: 'velas_lote', title: 'Velas de varios activos', description: 'Velas OHLCV recientes de varios símbolos en una sola llamada (máx. 20 símbolos y 300 velas). Una fila por símbolo y vela.', inputSchema: { type: 'object', properties: { simbolos: S_SIMBOLOS, intervalo: S_INTERVALO, n: { type: 'integer', minimum: 10, maximum: 300, description: 'Velas por símbolo (por defecto 120).' } }, additionalProperties: false }, fn: velasLote },
  { name: 'historico_diario', title: 'Historial diario largo', description: 'Velas diarias (UTC) de un activo desde una fecha: BTC desde 2015 y ETH desde 2016 vía Bitstamp; el resto, lo que haya en Kraken (hasta 720 días) o Hyperliquid. Una fila por día.', inputSchema: { type: 'object', properties: { simbolo: { type: 'string', description: 'p. ej. BTC, ETH, ORO, SP500' }, desde: { type: 'string', description: 'Fecha AAAA-MM-DD. Por defecto, la más antigua disponible.' } }, required: ['simbolo'], additionalProperties: false }, fn: historicoDiario },
  { name: 'derivados', title: 'Financiación y posiciones abiertas', description: 'Funding de los perpetuos cripto de Hyperliquid (ahora, media de 7 días y percentil de 30 días, anualizados), posiciones abiertas en dólares y prima frente al oráculo. Sirve para detectar exceso de apalancamiento.', inputSchema: { type: 'object', properties: { simbolos: S_SIMBOLOS }, additionalProperties: false }, fn: derivados },
  { name: 'funding_diario', title: 'Funding diario', description: 'Funding diario (suma de las 24 tasas horarias, UTC) de los perpetuos cripto de Hyperliquid en los últimos días cerrados (7 a 90). Una fila por símbolo y día. Sirve para el motor de cobro del funding.', inputSchema: { type: 'object', properties: { simbolos: S_SIMBOLOS, dias: { type: 'integer', minimum: 7, maximum: 90, description: 'Días cerrados hacia atrás (por defecto 60).' } }, additionalProperties: false }, fn: fundingDiario },
  { name: 'aprendizaje', title: 'Sistema que aprende', description: 'Estado del sistema que aprende cada hora (en papel): resumen, expertos y sus pesos, posiciones combinadas, curva diaria frente a Bitcoin, carteras seguidas con su habilidad, avisos, lo que propone el laboratorio y el bot de pruebas (50, 200 y 1000 € en papel en Kraken Futuros).', inputSchema: { type: 'object', properties: { vista: { type: 'string', enum: ['resumen', 'expertos', 'posiciones', 'curva', 'carteras', 'alertas', 'laboratorio', 'bot', 'ml'], description: 'Qué parte ver. Por defecto, resumen. bot: carteras en papel de 50, 200 y 1000 € que siguen al sistema en Kraken Futuros con costes y mínimos reales. ml: la señal diaria del aprendizaje automático y cómo le va a su experto.' } }, additionalProperties: false }, fn: aprendizaje },
  { name: 'mercados', title: 'Mercados disponibles', description: 'Lista de símbolos del radar, de dónde sale cada uno y qué otros mercados (acciones de EE. UU., etc.) hay disponibles.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, fn: mercados },
  { name: 'estado_fuentes', title: 'Estado de las fuentes', description: 'Comprueba si Hyperliquid, Kraken y Binance responden y cuánto tardan.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, fn: estadoFuentes },
];

// ---------- protocolo MCP (Streamable HTTP, sin sesión) ----------
const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05'];
async function rpc(msg, env) {
  const esNotificacion = !msg || msg.id === undefined || msg.id === null;
  const id = esNotificacion ? null : msg.id;
  const ok = (result) => (esNotificacion ? null : { jsonrpc: '2.0', id, result });
  const fallo = (code, message) => (esNotificacion ? null : { jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fallo(-32600, 'Petición JSON-RPC no válida');
  const params = msg.params || {};
  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: VERSIONES.includes(params.protocolVersion) ? params.protocolVersion : VERSIONES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'radar-mercados', title: 'Radar de mercados propio', version: VERSION },
        instructions: 'Incluye un sistema que aprende cada hora en papel (herramienta aprendizaje). Datos de mercado de fuentes públicas. Cripto: mercado real (Kraken; si no, perpetuo de Hyperliquid). Oro, plata, petróleo, índices, divisas y acciones de EE. UU.: aproximación por perpetuos de trade.xyz en Hyperliquid. No sirve para ejecutar órdenes: el precio de referencia es el del bróker.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: HERRAMIENTAS.map(({ fn, ...h }) => ({ ...h, annotations: { readOnlyHint: true, openWorldHint: true } })) });
    case 'tools/call': {
      const h = HERRAMIENTAS.find((x) => x.name === params.name);
      if (!h) return fallo(-32602, 'Herramienta desconocida: ' + params.name);
      try {
        const datos = await h.fn(params.arguments || {}, env);
        return ok({ content: [{ type: 'text', text: JSON.stringify(datos) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: 'Error: ' + (e.message || e) }], isError: true });
      }
    }
    default:
      return esNotificacion ? null : fallo(-32601, 'Método no soportado: ' + msg.method);
  }
}

const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const partes = url.pathname.split('/').filter(Boolean);
    const token = (env && env.TOKEN) || '';
    const auth = (request.headers.get('Authorization') || '').trim();
    const bearer = auth.slice(0, 7).toLowerCase() === 'bearer ' ? auth.slice(7).trim() : '';
    const vale = (t) => { // comparación en tiempo constante (solo se filtra la longitud)
      if (!token || typeof t !== 'string' || t.length !== token.length) return false;
      let d = 0;
      for (let i = 0; i < t.length; i++) d |= t.charCodeAt(i) ^ token.charCodeAt(i);
      return d === 0;
    };

    if (partes[0] === 'prueba') {
      if (!token) return new Response('Falta crear el secreto TOKEN en el Worker.', { status: 500 });
      if (!vale(partes[1])) return new Response('No encontrado', { status: 404 });
      const [estado, lista] = await Promise.all([estadoFuentes(), precios({ simbolos: ['BTC', 'ORO', 'SP500', 'EURUSD'] }).catch((e) => ({ error: e.message }))]);
      const aprende = env && env.DB ? await aprendizaje({ vista: 'resumen' }, env).then((r) => r.rows[0]).catch((e) => ({ error: e.message })) : 'falta la base de datos D1 (DB)';
      return json({ servidor: 'radar-mercados ' + VERSION, estado: estado.rows, muestra: lista, aprendizaje: aprende });
    }
    if (partes[0] !== 'mcp') return new Response('Radar de mercados', { status: 404 });
    if (!token) return new Response('Falta crear el secreto TOKEN en el Worker.', { status: 500 });
    if (!(vale(partes[1]) || vale(bearer))) return new Response('No encontrado', { status: 404 });
    if (request.method !== 'POST') return new Response('Este servidor MCP solo acepta POST.', { status: 405, headers: { Allow: 'POST' } });

    let cuerpo;
    try { cuerpo = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } }, 400); }
    const esLote = Array.isArray(cuerpo);
    const respuestas = (await Promise.all((esLote ? cuerpo : [cuerpo]).map((m) => rpc(m, env)))).filter(Boolean);
    if (!respuestas.length) return new Response(null, { status: 202 });
    return json(esLote ? respuestas : respuestas[0]);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const minuto = new Date(Date.now()).getUTCMinutes();
      const r = await apCiclo(env).catch((e) => { console.log('ciclo de aprendizaje: ' + (e.message || e)); return null; });
      // la hora en vivo usa 31 peticiones (precios y 30 carteras); el flujo se mide en los otros 59 minutos (19)
      if (r && r.ok && r.modo === 'al día') {
        await apMinuto(env).catch((e) => console.log('flujo de órdenes: ' + (e.message || e)));
        // mercados nuevos: 1 cada 10 minutos (:05, :15… :55), lejos de la hora en vivo; +2 peticiones
        if (minuto % 10 === 5) await apCalentarMinuto(env).catch((e) => console.log('calentar: ' + (e.message || e)));
        // laboratorio: +1 petición como mucho cada 6 h, y la señal del aprendizaje automático +1 cada 3 h, en un minuto sin calentamiento
        if (minuto === 37) await apLabMinuto(env).catch((e) => console.log('laboratorio: ' + (e.message || e)));
        // bot de pruebas: del minuto :07 al :12 hasta que haga la hora (+2 peticiones); fichas de Kraken a las :27 (+1, una vez al día)
        if (minuto >= BOT.MINUTO && minuto < BOT.MINUTO + 6) await botHora(env).catch((e) => console.log('bot: ' + (e.message || e)));
        if (minuto === BOT.MINUTO_FICHAS) await botFichas(env).catch((e) => console.log('fichas Kraken: ' + (e.message || e)));
      }
    })());
  },
};
