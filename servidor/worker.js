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

const VERSION = '2.9.0';
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
  // v2.7.0: también oro, plata, petróleo, gas, cobre, S&P 500, Nasdaq 100, euro y yen, por sus perpetuos de trade.xyz en
  // Hyperliquid (dex «xyz»). Siguen al mercado de referencia cuando está abierto; fuera de horario el precio es interno.
  // Sin flujo de órdenes, sin cobro del funding y sin bot de Kraken: solo para los expertos de dirección y la zona de prácticas.
  XYZ: ['xyz:GOLD', 'xyz:SILVER', 'xyz:CL', 'xyz:NATGAS', 'xyz:COPPER', 'xyz:SP500', 'xyz:XYZ100', 'xyz:EUR', 'xyz:JPY'],
};
AP.MERCADOS = AP.MONEDAS.concat(AP.XYZ);
const XYZ_NOMBRE = { 'xyz:GOLD': 'ORO', 'xyz:SILVER': 'PLATA', 'xyz:CL': 'WTI', 'xyz:NATGAS': 'GAS', 'xyz:COPPER': 'COBRE', 'xyz:SP500': 'SP500', 'xyz:XYZ100': 'NASDAQ100', 'xyz:EUR': 'EURUSD', 'xyz:JPY': 'USDJPY' };
const apEtiqueta = (m) => XYZ_NOMBRE[m] || m;

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
  { id: 'equipo_practicas', nombre: 'Equipo de la zona de prácticas (votan todos los alumnos)', familia: 'zona de prácticas', tipo: 'equipo' },
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
const ML_DIAS_VALIDA = 3;
// Traders elegidos por su historial completo (laboratorio, dos veces por semana): a quién sigue el sistema y, si el
// laboratorio comprobó que la puntuación predice, con qué habilidad parte cada uno en vez de empezar desde cero.
const TRADERS_URL = 'https://raw.githubusercontent.com/rendir-IEC/radar-laboratorio/main/resultados/traders/seleccion.json';
const TRADERS_CADA_H = 6;
const TRADERS_MAX = 30;            // el minuto en vivo no admite más peticiones
const TRADERS_MAX_BYTES = 32768;
const TRADERS_ENCOGE = 0.5;        // se eligieron las mejores entre cientos: su puntuación se encoge a la mitad (maldición del ganador)
const TRADERS_HORAS_PREVIA = 336;  // la previa cuenta como dos semanas de horas en vivo; con más horas manda lo visto en vivo
const TRADERS_DIAS_VALIDA = 14;
// Dónde está la ventaja esta semana (laboratorio, cada día laborable a las 22:41 UTC): ~25 mercados ordenados por su
// tendencia de 12 semanas ajustada a la volatilidad, con su historial. Se lee al pedir la vista (caché de 10 minutos).
const SEMANA_URL = 'https://raw.githubusercontent.com/rendir-IEC/radar-laboratorio/main/resultados/semana/ranking.json';
const SEMANA_MAX_BYTES = 65536;    // el archivo del laboratorio pesa ~16 KB; uno mucho mayor no se lee

// Avisos al móvil (v2.5.2) con ntfy (app gratuita, sin cuenta). El nombre del canal se genera al azar la primera vez,
// se guarda en la base de datos D1 y solo se ve con el TOKEN (vista «avisos»): nunca está en este código.
const NTFY_URL = 'https://ntfy.sh/';
const AVISO = {
  MINUTO: 47,                       // ranking semanal y plan: minuto libre de calentamiento, laboratorio y bot
  HORA_MANANA: 8,                   // los cambios del ranking de la noche salen a las 8:47 de Madrid
  HORA_PLAN: 9,                     // plan de Bitcoin: los lunes a las 9:47 de Madrid
  PLAN_DESDE: '2026-11-30',         // primer lunes del plan (la usuaria empieza a mover dinero en diciembre)
  NOCHE: [23, 8],                   // de 23:00 a 7:59 de Madrid los avisos de precio llegan sin sonido y los del ranking esperan
  MOV_PCT: { BTC: 5, ETH: 5 },      // solo estas monedas: movimiento en la última hora que dispara el aviso
  MOV_MAX_PCT: 40,                  // más que esto en una hora es un dato roto: no se avisa
  MUESTRA_MIN: 4.5,                 // una muestra de precio cada ~5 minutos, 65 minutos guardados
  REPETIR_H: 3,                     // el mismo aviso (moneda y sentido) no se repite en 3 h salvo que el movimiento crezca otro tanto
  PRUEBA_MIN: 10,                   // como mucho un aviso de prueba cada 10 minutos
  MAX_GUARDADOS: 30,
};
// Plan semanal de Bitcoin del laboratorio (laboratorio/plan/plan_core.js): reglas fijadas antes de ver resultados.
const PLAN_BTC = { CAPITAL: 962, SEMANAS_BASE: 12, MEDIA: 200, TRAMOS: [[0.8, 2], [1.0, 1.5], [1.5, 1], [2.4, 0.5], [Infinity, 0]] };
function apListaExpertos(E) {
  const lab = (E && E.lab && E.lab.specs) || [];
  const grad = (E && E.graduados) || []; // graduados de la zona de prácticas (v2.6.0): compiten como candidatas, con poco peso
  if (!lab.length && !grad.length) return AP_EXPERTOS;
  return AP_EXPERTOS.concat(lab.map((s) => ({ id: s.id, nombre: 'Laboratorio: ' + s.nombre, familia: 'laboratorio', tipo: 'lab', spec: s.spec, aprobadaLab: !!s.aprobada })),
    grad.map((g) => ({ id: g.id, nombre: 'Graduado en prácticas: ' + g.nombre, familia: 'zona de prácticas', tipo: 'lab', spec: g.spec, aprobadaLab: false })));
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
  if (sp.forma !== 'signo') extra.push('proporcional');
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
  for (const m of AP.MERCADOS) {
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
  for (const m of AP.MERCADOS) {
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
      W.visto = snap.t;
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
    for (const ex of activos) E.lw[ex.id] = Math.log((1 - AP.REPARTO) * w[ex.id] + ((ex.tipo === 'lab' && !ex.aprobadaLab) || ex.tipo === 'ml' || ex.tipo === 'equipo' ? 1e-12 : AP.REPARTO / M));
    const maxLw = Math.max(...activos.map((ex) => E.lw[ex.id]));
    for (const ex of activos) E.lw[ex.id] -= maxLw;
  }
  // 4) posiciones nuevas de cada experto (y activar los que ya tienen datos suficientes)
  const listas = AP.MERCADOS.filter((m) => E.monedas[m] && E.monedas[m].n >= 720 && snap.px[m] > 0);
  const habilidad = apHabilidades(E);
  for (const ex of EXPERTOS) {
    let X = E.expertos[ex.id];
    const nueva = apPosiciones(E, ex, listas, habilidad, snap.t);
    if (!nueva) continue;
    if (!X) {
      X = E.expertos[ex.id] = { activo: true, desde: snap.t, st: apStats(), pos: {}, coste: 0, ultima: 0 };
      const vals = Object.values(E.lw);
      E.lw[ex.id] = vals.length ? Math.log(vals.reduce((a, b) => a + Math.exp(b), 0) / vals.length) : 0;
      if ((ex.tipo === 'lab' && !ex.aprobadaLab) || ex.tipo === 'ml' || ex.tipo === 'equipo') E.lw[ex.id] += Math.log(Math.max(LAB_PESO_PRUEBA, 1e-9));
      apAlerta(E, snap.t, 'nuevo', ex.id, 'Empieza a aprender: ' + ex.nombre);
    }
    // banda sin operar: si la posición solo cambia un poco (menos del 25 %), se deja como estaba y no se pagan comisiones
    if (ex.tipo === 'dir' || ex.tipo === 'copia' || ex.tipo === 'lab' || ex.tipo === 'equipo') {
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
  for (const m of AP.MERCADOS) {
    const v = comb[m] || 0;
    const antes = E.senal[m] || 0;
    const ahora = v >= 0.05 ? 1 : v <= -0.05 ? -1 : Math.abs(v) < 0.01 ? 0 : antes;
    if (ahora !== antes && E.horas > 0) apAlerta(E, snap.t, 'senal', m, apEtiqueta(m) + ': la cartera en papel pasa a ' + (ahora > 0 ? 'comprar' : ahora < 0 ? 'vender' : 'no tener') + ' (' + (v * 100).toFixed(1) + ' % del dinero; no es una recomendación)');
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

// Habilidad de cada cartera: prueba t de su rentabilidad hora a hora en vivo (desde 24 horas), combinada con la
// puntuación de su historial (encogida) cuando el laboratorio comprobó que predice. Sin previa, igual que antes.
function apPrevias(E) {
  const out = {};
  if (E.traders && E.traders.previa) for (const x of E.traders.lista || []) out[x.d] = TRADERS_ENCOGE * x.t;
  return out;
}
function apHabilidades(E) {
  const previas = apPrevias(E);
  const out = {};
  for (const [addr, W] of Object.entries(E.carteras)) {
    const st = W.st;
    const zp = previas[addr] || 0;
    let zl = 0, n = 0;
    if (st.n >= 24) {
      const m = st.s1 / st.n, v = Math.max(st.s2 / st.n - m * m, 1e-12);
      zl = (m / Math.sqrt(v)) * Math.sqrt(st.n);
      n = st.n;
    }
    const a = zp ? Math.sqrt(TRADERS_HORAS_PREVIA) : 0, b = Math.sqrt(n);
    if (!(a + b > 0)) { out[addr] = { habilidad: 0, t: 0, tVivo: 0, previa: 0, n: st.n }; continue; }
    const t = (a * zp + b * zl) / Math.sqrt(a * a + b * b);
    out[addr] = { habilidad: t > 0 ? Math.max(0, 2 * apPhi(t) - 1) : 0, t, tVivo: zl, previa: zp, n: st.n };
  }
  return out;
}

function apPosiciones(E, ex, listas, habilidad, t) {
  const pos = {};
  if (ex.tipo === 'cash') return pos;
  if (ex.tipo === 'lab') return listas.length ? apLabPosiciones(E, ex, listas, t) : null;
  if (ex.tipo === 'equipo') { // lo que votó el equipo de alumnos la hora anterior (zona de prácticas, v2.8.0)
    if (!E.equipo || !E.equipo.pos || t - E.equipo.t > 3 * H1) return E.expertos[ex.id] ? {} : null;
    for (const m of listas) if (E.equipo.pos[m]) pos[m] = E.equipo.pos[m];
    return pos;
  }
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
    // con previa del historial, una cartera cuenta desde su primera hora; sin ella, desde las 24 horas
    const cart = Object.entries(E.carteras).filter(([addr, W]) => W.av > 0 && (W.st.n >= 24 || (ex.habilidad && habilidad[addr] && habilidad[addr].previa > 0)));
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
  const compite = (id) => tipo[id] === 'dir' || tipo[id] === 'copia' || tipo[id] === 'lab' || tipo[id] === 'ml' || tipo[id] === 'equipo';
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
// A quién se sigue: la selección del laboratorio si es reciente; si no, la lista fija de arriba.
function apSeguidas(E, ahora) {
  const T = E.traders;
  if (T && Array.isArray(T.lista) && T.lista.length >= 5 && ahora - T.tGen <= TRADERS_DIAS_VALIDA * 86400e3) return T.lista.map((x) => x.d).slice(0, TRADERS_MAX);
  return CARTERAS_SEGUIDAS;
}
// La que deja de seguirse guarda lo aprendido (su rentabilidad en vivo), pero no sus posiciones: así no cuenta en la copia.
// Si pasan 60 días sin volver a la selección, se olvida.
function apDejarDeSeguir(E, seguidas, ahora) {
  const set = new Set(seguidas);
  for (const [addr, W] of Object.entries(E.carteras || {})) {
    if (set.has(addr)) continue;
    W.pos = {}; W.px = {}; W.av = null;
    if (ahora - (W.visto || W.desde || ahora) > 60 * 86400e3) delete E.carteras[addr];
  }
  E.seguidas = seguidas.length;
}

// Dos veces al día como mucho (en vivo, minuto :37) lee la selección de traders del laboratorio. Usa 1 petición.
// Solo acepta direcciones bien formadas y puntuaciones acotadas; nunca ejecuta nada que venga de fuera.
async function apTraders(E) {
  E.tradersIntento = Date.now();
  let j;
  try {
    const r = await fetch(TRADERS_URL, { headers: { 'User-Agent': 'radar-mercados/' + VERSION } });
    if (!r.ok) return false;
    if (Number(r.headers && r.headers.get && r.headers.get('content-length')) > TRADERS_MAX_BYTES) return false;
    const txt = await r.text();
    if (txt.length > TRADERS_MAX_BYTES) return false;
    j = JSON.parse(txt);
  } catch (e) { return false; }
  if (!j || typeof j !== 'object' || j.version !== 1 || !Array.isArray(j.carteras)) return false;
  const gen = String(j.generado || '').slice(0, 32);
  const tGen = Date.parse(gen);
  if (!Number.isFinite(tGen) || tGen > Date.now() + 3600e3) return false;
  if (E.traders && E.traders.gen === gen) return false;
  const lista = [], vistas = new Set();
  for (const c of j.carteras) {
    const d = String((c && c.direccion) || '').toLowerCase();
    const t = Number(c && c.t);
    if (!/^0x[0-9a-f]{40}$/.test(d) || vistas.has(d) || !Number.isFinite(t) || t <= 0) continue;
    vistas.add(d);
    lista.push({ d, t: Math.min(t, 8), tipo: c.tipo === 'vault' ? 'vault' : 'cuenta' });
    if (lista.length >= TRADERS_MAX) break;
  }
  if (lista.length < 5) return false;
  const antes = new Set(((E.traders && E.traders.lista) || CARTERAS_SEGUIDAS.map((d) => ({ d }))).map((x) => x.d));
  const nuevas = lista.filter((x) => !antes.has(x.d)).length;
  E.traders = { gen, tGen, previa: j.usar_previa === true, lista, leida: Date.now() };
  apAlerta(E, E.t, 'traders', gen, 'Nueva selección de traders por su historial completo: sigue a ' + lista.length + ' (' + nuevas + ' nuevas). ' + (E.traders.previa ? 'El laboratorio comprobó que su historial predice algo: parten con esa habilidad, encogida, y la ajustan en vivo.' : 'Su historial no predijo lo bastante en la prueba: la habilidad se aprende en vivo, como hasta ahora.'));
  return true;
}

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
  // oro, petróleo, índices y divisas: perpetuos de trade.xyz (+1 petición); si falla, esa hora aprenden solo las cripto
  try {
    const [mx, cx] = await hl({ type: 'metaAndAssetCtxs', dex: 'xyz' });
    ((mx && mx.universe) || []).forEach((a, i) => {
      const c = cx && cx[i];
      if (!c || a.isDelisted) return;
      const nombre = String(a.name).includes(':') ? a.name : 'xyz:' + a.name;
      enDex.add(nombre);
      if (!AP.XYZ.includes(nombre)) return;
      const precio = num(c.markPx);
      if (precio > 0) p[nombre] = precio;
      const fr = num(c.funding); if (fr != null) f[nombre] = fr;
    });
  } catch (e) { console.log('xyz: ' + (e.message || e)); for (const m of AP.XYZ) enDex.add(m); }
  // los mercados nuevos se calientan en otros minutos (apCalentarMinuto), no en este, que ya es el más cargado
  E.fueraDex = AP.MERCADOS.filter((m) => !enDex.has(m));
  const carteras = {};
  const seguidas = apSeguidas(E, ahora);
  apDejarDeSeguir(E, seguidas, ahora);
  // un solo intento por cartera: con 30 carteras y 3 intentos, un 429 de Hyperliquid agota el límite de 50 subpeticiones
  const res = await Promise.allSettled(seguidas.map((addr) => pedir(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'clearinghouseState', user: addr }) }, 1)));
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value || !r.value.marginSummary) return;
    const pos = {};
    for (const ap of r.value.assetPositions || []) { const q = ap && ap.position; if (q && num(q.szi)) pos[q.coin] = num(q.szi); }
    carteras[seguidas[i]] = { av: num(r.value.marginSummary.accountValue), pos };
  });
  // cazadores de funding: con los datos de esta misma hora (sin peticiones de más); si fallan, el sistema sigue
  let C = null, cz = null;
  try { C = (await czCargar(env)) || czNuevo(horaActual); cz = czPaso(C, czMercados(meta, ctxs), horaActual); } catch (e) { console.log('cazadores: ' + (e.message || e)); C = null; }
  const flujo = await apFlujoDeLaHora(env, horaActual - H1);
  const antes = prFoto(E);
  apPaso(E, { t: horaActual, px: p, f, carteras, pxTodos: todos, flujo });
  // zona de prácticas: sin peticiones de más; si falla, el sistema sigue
  let P = null, pr = null;
  try { P = (await prCargar(env)) || prNuevo(horaActual); pr = prPaso(E, P, { t: horaActual, px: p }, antes); } catch (e) { console.log('prácticas: ' + (e.message || e)); P = null; }
  curva.push([horaActual, E.sistema.log, E.btcLog, E.sistema.n]);
  await apGuardar(env, E, curva);
  if (P) await prGuardar(env, P).catch((e) => console.log('prácticas: ' + (e.message || e)));
  if (C) await czGuardar(env, C).catch((e) => console.log('cazadores: ' + (e.message || e)));
  if (pr && pr.graduados.length) await avisosGraduados(env, pr.graduados, horaActual).catch((e) => console.log('avisos: ' + (e.message || e)));
  return { ok: true, modo: 'en vivo', hora: iso(horaActual), carteras: Object.keys(carteras).length, practicas: pr ? { quiebras: pr.quiebras.length, retirados: pr.retirados, graduados: pr.graduados.length } : null };
}

// Lo que ve el panel.
// ---------- calentar mercados nuevos: cargan sus últimas 800 horas para entrar ya en el aprendizaje ----------
async function apCalentar(E, limite, enDex) {
  if (E.t == null) return [];
  // por turnos: una moneda que no puede calentarse (p. ej. con menos de 720 h de historia) no bloquea a las demás
  const intentos = E.calentar || (E.calentar = {});
  const faltan = AP.MERCADOS.filter((m) => (!E.monedas[m] || E.monedas[m].n < AP.HORAS_MIN) && (!enDex || enDex.has(m)))
    .sort((a, b) => (intentos[a] || 0) - (intentos[b] || 0)).slice(0, limite);
  const hechos = [];
  for (const m of faltan) {
    intentos[m] = E.t;
    try {
      const [v, fh] = await Promise.all([
        hl({ type: 'candleSnapshot', req: { coin: m, interval: '1h', startTime: E.t - 800 * H1, endTime: E.t } }),
        hl({ type: 'fundingHistory', coin: m, startTime: E.t - 200 * H1, endTime: E.t }).catch(() => []), // sin funding se calienta igual
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
  if (hechos.length) apAlerta(E, Math.floor(Date.now() / 60e3) * 60e3, 'mercados', hechos.join(','), 'Se incorporan al aprendizaje: ' + hechos.map(apEtiqueta).join(', ') + ' (con sus últimas 800 horas de memoria)');
  return hechos;
}

// Laboratorio: como mucho cada 6 h, en el minuto :37, lejos de la hora en vivo. Guarda solo si nadie ha escrito
// una hora nueva entretanto (mismo patrón que apCalentarMinuto). +1 petición.
async function apLabMinuto(env) {
  const E = await apCargar(env);
  const ahora = Date.now();
  const tocaLab = !(E.labIntento && ahora - E.labIntento < LAB_CADA_H * 3600e3);
  const tocaMl = !(E.mlIntento && ahora - E.mlIntento < ML_CADA_H * 3600e3);
  const tocaTraders = !(E.tradersIntento && ahora - E.tradersIntento < TRADERS_CADA_H * 3600e3);
  if (E.t == null || (!tocaLab && !tocaMl && !tocaTraders)) return { ok: true, modo: 'nada que leer' };
  const tAntes = E.t;
  const cambio = tocaLab ? await apLab(E) : false;
  if (tocaMl) await apMl(E);
  if (tocaTraders) await apTraders(E);
  await env.DB.prepare('UPDATE ap_estado SET json = ?1 WHERE id = ?2 AND t = ?3').bind(JSON.stringify(E), 'principal', tAntes).run();
  return { ok: true, modo: 'laboratorio', cambio };
}

// Calienta 1 mercado en un minuto sin hora en vivo (CPU y peticiones aparte). Escribe solo si nadie ha guardado otra hora entretanto.
async function apCalentarMinuto(env) {
  const E = await apCargar(env);
  if (E.t == null) return { ok: true, modo: 'nada que calentar' };
  const fuera = new Set(E.fueraDex || []);
  if (!AP.MERCADOS.some((m) => (!E.monedas[m] || E.monedas[m].n < AP.HORAS_MIN) && !fuera.has(m))) return { ok: true, modo: 'nada que calentar' };
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
  const mids = {};
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
    if (pc > 0 && pv > 0) mids[m] = (pc + pv) / 2;
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
  const movs = avisoMovimientos(F, mids, ahora);
  await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('flujo', JSON.stringify(F), ahora).run();
  if (movs.length) await avisosMovimientos(env, movs, ahora).catch((e) => console.log('avisos: ' + (e.message || e)));
  return { ok: true, modo: 'flujo', minuto, avisos: movs.length };
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

// Lee y valida el ranking semanal del laboratorio: solo textos cortos y números finitos; nunca ejecuta nada de fuera.
async function semanaLeer() {
  let j;
  try {
    const r = await fetch(SEMANA_URL, { headers: { 'User-Agent': 'radar-mercados/' + VERSION }, cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok) return { error: 'El laboratorio aún no ha publicado el ranking de la semana.' };
    const txt = await r.text();
    if (txt.length > SEMANA_MAX_BYTES) return { error: 'El ranking es demasiado grande: no se lee.' };
    j = JSON.parse(txt);
  } catch (e) { return { error: 'No se pudo leer el ranking de la semana.' }; }
  if (!j || typeof j !== 'object' || j.version !== 1 || !Array.isArray(j.mercados)) return { error: 'El ranking no tiene el formato esperado.' };
  const tx = (x, n) => (typeof x === 'string' ? x.slice(0, n) : null);
  const nf = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const st = (o) => (o && typeof o === 'object' ? { semanas: nf(o.semanas), positivasPct: nf(o.positivasPct), mediaSemanaPct: nf(o.mediaSemanaPct), t: nf(o.t), anualPct: nf(o.anualPct), caidaMaxPct: nf(o.caidaMaxPct) } : null);
  const mercados = j.mercados.slice(0, 40).filter((m) => m && typeof m.simbolo === 'string' && /^[A-Z0-9]{2,16}$/.test(m.simbolo)).map((m) => {
    const p = nf(m.puntuacion);
    return {
      puesto: nf(m.puesto), simbolo: m.simbolo, nombre: tx(m.nombre, 60), clase: tx(m.clase, 20), comoComprar: tx(m.comoComprar, 80), cierre: tx(m.cierre, 10),
      rend12SemPct: nf(m.rend12SemPct), volSemanalPct: nf(m.volSemanalPct), puntuacion: p, direccion: p != null && p > 0 ? 'al alza' : 'a la baja',
      fuerza: p == null ? null : p >= 1 ? 'fuerte' : p > 0 ? 'débil' : 'ninguna',
      aciertoPct: nf(m.aciertoPct), mediaSemanaPct: nf(m.mediaSemanaPct), siguienteComoAhoraPct: nf(m.siguienteComoAhoraPct),
      soloComprasAnualPct: nf(m.soloComprasAnualPct), soloComprasCaidaMaxPct: nf(m.soloComprasCaidaMaxPct), mantenerAnualPct: nf(m.mantenerAnualPct),
      semanas: nf(m.semanas), desde: tx(m.desde, 10), enTop3: m.enTop3 === true,
    };
  });
  const c = j.cartera && typeof j.cartera === 'object' ? j.cartera : {};
  const g = j.global && typeof j.global === 'object' ? j.global : {};
  const fuerza = (Array.isArray(g.porFuerza) ? g.porFuerza : []).slice(0, 12).map((f) => ({ desde: nf(f && f.desde), hasta: nf(f && f.hasta), casos: nf(f && f.casos), mediaSemanaSiguientePct: nf(f && f.mediaSemanaSiguientePct), subePct: nf(f && f.subePct), t: nf(f && f.t) }));
  const resumen = [
    ['Las 3 de mejor tendencia, cada semana', c.top3], ['Las 3 de mejor tendencia, últimos 2 años', c.top3UltimosDosAnos],
    ['Todos los mercados a partes iguales', c.todosIgual], ['Solo Bitcoin', c.bitcoin],
  ].map(([que, o]) => ({ que, desde: tx(c.desde, 10), ...(st(o) || {}) }));
  return { generado: tx(j.generado, 32), mercados, resumen, fuerza };
}
const SEMANA_NOTA = 'Laboratorio: cada día laborable ordena unos 25 mercados (cripto, materias primas, índices, bonos y divisas) por su tendencia de 12 semanas dividida por su volatilidad (puntuación). Fuerza: fuerte desde 1, débil entre 0 y 1, ninguna por debajo de 0. Historial con cierres semanales públicos desde 2004 y un 0,10 % por operación. Investigación en papel; no es una recomendación.';

// ---------- avisos al móvil (v2.5.2) por ntfy ----------
// Solo avisos para actuar o seguir algo importante (los resúmenes se ven en el panel):
// 1) señal del ranking semanal: un mercado entra o sale de la tendencia fuerte (se mira cada hora en el minuto :47);
// 2) plan de Bitcoin: los lunes a las 9:47 de Madrid, cuánto toca comprar esa semana según la regla (si toca algo);
// 3) BTC o ETH se mueven un 5 % o más en una hora, medido cada minuto con el libro de órdenes que ya se lee (sin peticiones de más).
// De noche los de precio llegan sin sonido y los del ranking esperan a las 8:47.
function madrid(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { fecha: p.year + '-' + p.month + '-' + p.day, hora: Number(p.hour), dia: p.weekday, laborable: p.weekday !== 'Sat' && p.weekday !== 'Sun' };
}
const deNoche = (hora) => hora >= AVISO.NOCHE[0] || hora < AVISO.NOCHE[1];
const comaFija = (x, d = 1) => x.toFixed(d).replace('.', ',');
const conSigno = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + comaFija(Math.abs(x), d);
function fmtPx(x) {
  if (x >= 1000) return Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return x >= 1 ? comaFija(x, 2) : x.toPrecision(3).replace('.', ',');
}
function avisoCanalNuevo() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', b = new Uint8Array(15);
  crypto.getRandomValues(b);
  return 'radar-' + Array.from(b, (x) => abc[x % 32]).join('');
}
async function avisosCargar(env) {
  await apTablas(env);
  let fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('avisos').first();
  if (!fila) { // primera vez: el canal se crea una sola vez aunque dos minutos lleguen a la vez
    await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING').bind('avisos', JSON.stringify({ canal: avisoCanalNuevo(), creado: iso(Date.now()), enviados: [] }), Date.now()).run();
    fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('avisos').first();
  }
  const A = JSON.parse(fila.json);
  if (!Array.isArray(A.enviados)) A.enviados = [];
  return A;
}
async function avisosGuardar(env, A) {
  await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('avisos', JSON.stringify(A), Date.now()).run();
}
async function avisoMandar(A, { titulo, texto, prioridad = 3, etiquetas = [] }, ahora) {
  let ok = false, estado = null;
  try {
    const r = await fetch(NTFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'radar-mercados/' + VERSION }, body: JSON.stringify({ topic: A.canal, title: titulo, message: texto, priority: prioridad, tags: etiquetas }) });
    ok = r.ok; estado = r.status;
  } catch (e) { estado = 'sin respuesta'; }
  A.enviados.unshift({ t: iso(ahora), titulo, texto, prioridad, ok, estado });
  if (A.enviados.length > AVISO.MAX_GUARDADOS) A.enviados.length = AVISO.MAX_GUARDADOS;
  return ok;
}

// Guarda una muestra de precio cada ~5 minutos y devuelve las monedas que se han movido de más en la última hora.
function avisoMovimientos(F, mids, ahora) {
  F.px = F.px || {}; F.avMov = F.avMov || {};
  for (const m of Object.keys(F.px)) if (!AVISO.MOV_PCT[m]) delete F.px[m];
  const salen = [];
  for (const [m, mid] of Object.entries(mids)) {
    if (!AVISO.MOV_PCT[m] || !(mid > 0)) continue;
    const serie = (Array.isArray(F.px[m]) ? F.px[m] : []).filter((x) => Array.isArray(x) && ahora - x[0] <= 65 * 60e3 && x[1] > 0);
    let mayor = null;
    for (const [t, p] of serie) {
      if (ahora - t > 60 * 60e3 + 30e3) continue;
      const c = (mid / p - 1) * 100;
      if (!mayor || Math.abs(c) > Math.abs(mayor.c)) mayor = { c, p, t };
    }
    // una muestra que salta más del máximo respecto a la anterior es un dato roto: no se guarda
    const ult = serie[serie.length - 1];
    if ((!ult || ahora - ult[0] >= AVISO.MUESTRA_MIN * 60e3) && !(ult && Math.abs((mid / ult[1] - 1) * 100) > AVISO.MOV_MAX_PCT)) serie.push([ahora, mid]);
    F.px[m] = serie;
    const umbral = AVISO.MOV_PCT[m];
    if (!mayor || Math.abs(mayor.c) < umbral || Math.abs(mayor.c) > AVISO.MOV_MAX_PCT) continue;
    const dir = mayor.c > 0 ? 1 : -1, u = F.avMov[m];
    if (u && ahora - u.t < AVISO.REPETIR_H * H1 && u.dir === dir && Math.abs((mid / u.px - 1) * 100) < umbral) continue;
    F.avMov[m] = { t: ahora, px: mid, dir };
    salen.push({ m, c: mayor.c, desde: mayor.p, hasta: mid, min: Math.max(1, Math.round((ahora - mayor.t) / 60e3)) });
  }
  return salen;
}
function avisoTextoMovimientos(movs, noche) {
  const orden = movs.slice().sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const x = orden[0], baja = x.c < 0;
  const titulo = orden.length === 1
    ? x.m + (baja ? ' cae un ' : ' sube un ') + comaFija(Math.abs(x.c)) + ' % en ' + x.min + ' min'
    : 'Movimiento fuerte: ' + orden.slice(0, 3).map((y) => y.m + ' ' + conSigno(y.c) + ' %').join(', ') + (orden.length > 3 ? ' y ' + (orden.length - 3) + ' más' : '');
  const lineas = orden.slice(0, 8).map((y) => y.m + ' ' + conSigno(y.c) + ' % en ' + y.min + ' min: de ' + fmtPx(y.desde) + ' a ' + fmtPx(y.hasta) + ' $');
  return { titulo, texto: lineas.join('\n') + '\nPrecio de Hyperliquid. Es un aviso de vigilancia, no una recomendación.', prioridad: noche ? 2 : 4, etiquetas: [baja ? 'chart_with_downwards_trend' : 'chart_with_upwards_trend'] };
}
async function avisosGraduados(env, nombres, ahora) {
  const A = await avisosCargar(env);
  await avisoMandar(A, { titulo: nombres.length > 1 ? 'Se gradúan ' + nombres.length + ' alumnos de la zona de prácticas' : 'Se gradúa un alumno de la zona de prácticas',
    texto: nombres.join('\n') + '\nGanó un mes en vivo pasando la prueba contra la suerte. Entra a competir en el sistema con poco peso; sigue en papel.', prioridad: deNoche(madrid(ahora).hora) ? 2 : 3, etiquetas: ['mortar_board'] }, ahora);
  await avisosGuardar(env, A);
}
async function avisosMovimientos(env, movs, ahora) {
  const A = await avisosCargar(env);
  await avisoMandar(A, avisoTextoMovimientos(movs, deNoche(madrid(ahora).hora)), ahora);
  await avisosGuardar(env, A);
}

// Ranking semanal: quién entra o sale de la tendencia fuerte (puntuación desde 1).
const avisoFicha = (m) => ({ simbolo: m.simbolo, nombre: m.nombre, puntuacion: m.puntuacion, siguienteComoAhoraPct: m.siguienteComoAhoraPct, aciertoPct: m.aciertoPct, comoComprar: m.comoComprar });
function avisoLineasCambio(cambios) {
  const l = [];
  for (const c of cambios) {
    for (const m of c.entran) l.push('Entra ' + (m.nombre || m.simbolo) + ' (' + m.simbolo + '), puntuación ' + comaFija(m.puntuacion || 0, 2) + (m.siguienteComoAhoraPct != null ? '. Cuando estuvo así, la semana siguiente hizo de media ' + conSigno(m.siguienteComoAhoraPct, 2) + ' %' : '') + (m.aciertoPct != null ? ' (acierto ' + Math.round(m.aciertoPct) + ' %)' : '') + (m.comoComprar ? '. Cómo: ' + m.comoComprar : '') + '.');
    for (const m of c.salen) l.push('Sale ' + (m.nombre || m.simbolo) + ' (' + m.simbolo + '): su tendencia ya no es fuerte.');
  }
  return l;
}
function avisoTextoCambio(cambios) {
  const entran = cambios.flatMap((c) => c.entran.map((m) => m.simbolo)), salen = cambios.flatMap((c) => c.salen.map((m) => m.simbolo));
  const titulo = 'Tendencia fuerte: ' + [entran.length ? (entran.length > 1 ? 'entran ' : 'entra ') + entran.join(', ') : '', salen.length ? (salen.length > 1 ? 'salen ' : 'sale ') + salen.join(', ') : ''].filter(Boolean).join(' · ');
  return { titulo, texto: avisoLineasCambio(cambios).join('\n') + '\nRanking de 12 semanas del laboratorio. Investigación en papel, no una recomendación.', prioridad: 3, etiquetas: ['bar_chart'] };
}
// Plan de Bitcoin con el último cierre diario completo (el del domingo, si es lunes). Misma regla que el panel.
async function avisoPlan(ahora) {
  const hoy = fechaDe(ahora);
  const h = await historicoDiario({ simbolo: 'BTC', desde: fechaDe(ahora - 320 * 86400e3) });
  const c = h.rows.filter((r) => r.fecha < hoy && r.c > 0);
  if (c.length < PLAN_BTC.MEDIA) return null;
  const n = c.length, media = c.slice(n - PLAN_BTC.MEDIA).reduce((a, r) => a + r.c, 0) / PLAN_BTC.MEDIA;
  const M = c[n - 1].c / media;
  let veces = 0;
  for (const [hasta, x] of PLAN_BTC.TRAMOS) if (M < hasta) { veces = x; break; }
  const base = PLAN_BTC.CAPITAL / PLAN_BTC.SEMANAS_BASE;
  return { fecha: c[n - 1].fecha, precio: c[n - 1].c, media200: media, mayer: M, veces, baseEur: base, compraEur: Math.min(PLAN_BTC.CAPITAL, base * veces) };
}
function avisoTextoPlan(P) {
  const dist = (P.mayer - 1) * 100;
  return {
    titulo: 'Plan de Bitcoin: esta semana ' + Math.round(P.compraEur) + ' €',
    texto: 'Bitcoin cerró el ' + P.fecha.slice(8, 10) + '/' + P.fecha.slice(5, 7) + ' en ' + fmtPx(P.precio) + ' $, un ' + comaFija(Math.abs(dist), 0) + ' % ' + (dist < 0 ? 'por debajo' : 'por encima') + ' de su media de 200 días (múltiplo ' + comaFija(P.mayer, 2) + ' → ×' + comaFija(P.veces, 1) + ' sobre la base de ' + Math.round(P.baseEur) + ' €).\nRegla del plan fijada de antemano; la decisión es tuya.',
    prioridad: 3, etiquetas: ['moneybag'],
  };
}
async function avisosHora(env, ahora = Date.now()) {
  const S = await semanaLeer();
  const A = await avisosCargar(env);
  const md = madrid(ahora);
  let cambia = false;
  if (!S.error && S.generado && S.generado !== A.semanaGenerado) {
    const fuertes = S.mercados.filter((m) => m.fuerza === 'fuerte');
    if (Array.isArray(A.fuertes)) { // la primera lectura solo fija el punto de partida
      const antes = new Set(A.fuertes.map((m) => m.simbolo)), ya = new Set(fuertes.map((m) => m.simbolo));
      const cambio = { t: iso(ahora), entran: fuertes.filter((m) => !antes.has(m.simbolo)).map(avisoFicha), salen: A.fuertes.filter((m) => !ya.has(m.simbolo)) };
      if (cambio.entran.length || cambio.salen.length) {
        if (deNoche(md.hora)) A.pendientes = [...(A.pendientes || []), cambio].slice(-5);
        else { await avisoMandar(A, avisoTextoCambio([...(A.pendientes || []), cambio]), ahora); A.pendientes = []; }
      }
    }
    A.fuertes = fuertes.map((m) => ({ simbolo: m.simbolo, nombre: m.nombre }));
    A.semanaGenerado = S.generado; cambia = true;
  }
  if (!deNoche(md.hora) && (A.pendientes || []).length) { // lo de la noche, a primera hora (8:47)
    await avisoMandar(A, avisoTextoCambio(A.pendientes), ahora);
    A.pendientes = []; cambia = true;
  }
  if (md.dia === 'Mon' && md.hora === AVISO.HORA_PLAN && md.fecha >= AVISO.PLAN_DESDE && A.planFecha !== md.fecha) {
    A.planFecha = md.fecha; cambia = true;
    const P = await avisoPlan(ahora).catch(() => null);
    A.plan = P ? { fecha: P.fecha, mayer: P.mayer, compraEur: P.compraEur } : { error: 'sin datos de Bitstamp' };
    if (P && P.compraEur > 0) await avisoMandar(A, avisoTextoPlan(P), ahora);
  }
  if (cambia) await avisosGuardar(env, A);
  return { ok: true, cambia };
}
async function avisosVista(env, prueba) {
  const A = await avisosCargar(env);
  const ahora = Date.now();
  let resultado = null;
  if (prueba) {
    if (A.pruebaT && ahora - Date.parse(A.pruebaT) < AVISO.PRUEBA_MIN * 60e3) resultado = 'Ya se mandó una prueba hace menos de ' + AVISO.PRUEBA_MIN + ' minutos.';
    else {
      A.pruebaT = iso(ahora);
      const ok = await avisoMandar(A, { titulo: 'Radar: aviso de prueba', texto: 'Si lees esto, los avisos del radar llegan a tu móvil.', prioridad: 3, etiquetas: ['white_check_mark'] }, ahora);
      resultado = ok ? 'Prueba enviada.' : 'ntfy no aceptó la prueba: ' + A.enviados[0].estado;
      await avisosGuardar(env, A);
    }
  }
  return {
    rows: A.enviados, canal: A.canal, servidor: 'ntfy.sh', creado: A.creado, prueba: resultado,
    vigilando: { tendenciaFuerte: (A.fuertes || []).map((m) => m.simbolo), pendientesParaLaManana: (A.pendientes || []).length, ultimoRanking: A.semanaGenerado || null, ultimoPlan: A.plan || null },
    nota: 'Avisos al móvil con la app ntfy (servidor ntfy.sh), solo para actuar o seguir algo importante; los resúmenes están en el panel. 1) Ranking semanal: un mercado entra o sale de la tendencia fuerte. 2) Plan de Bitcoin: los lunes a las ' + AVISO.HORA_PLAN + ':' + AVISO.MINUTO + ' de Madrid, si la regla dice comprar algo esa semana (desde el ' + AVISO.PLAN_DESDE + '). 3) BTC o ETH: un ' + AVISO.MOV_PCT.BTC + ' % o más en una hora. De 23:00 a 8:00 los de precio llegan sin sonido y los del ranking esperan a las ' + AVISO.HORA_MANANA + ':' + AVISO.MINUTO + '. El nombre del canal es la única llave: no lo publiques.',
  };
}

// ---------- zona de prácticas (v2.6.0; grupo de arriesgados desde la v2.6.1) ----------
// Cada estrategia del sistema tiene alumnos que practican en papel, cada uno con su propio dinero de prácticas: variantes
// de sus parámetros y de su riesgo (×1, ×2 y ×3 la exposición). Arriesgan, pierden y se retiran; los mejores tienen hijos
// con un cambio; la curiosidad prueba ideas nuevas lejos de lo ya probado. Solo se gradúa (y entra a competir en el sistema,
// con poco peso y solo sube si gana) quien gana en vivo al menos un mes con un Sharpe deflactado que cuenta TODAS las
// pruebas hechas: probar mucho sube el listón. Nada de esto mueve dinero.
// v2.6.1, a petición de la usuaria: un grupo propio de 12 alumnos arriesgados, con apalancamiento ×5 o ×10 o con todo el
// dinero en 1 o 3 monedas (sin ajustar por volatilidad), que compiten entre ellos. La zona mide si arriesgar más da más o solo
// quiebra antes.
const PR = {
  ALUMNOS: 24,               // grupo normal
  ARRIESGADOS: 12,           // grupo arriesgado
  RIESGOS: [1, 2, 3],
  RIESGOS_ALTOS: [3, 5, 10], // en el grupo arriesgado, ×3 solo si concentra en 1 o 3 monedas
  CONC: [1, 3],
  RONDA_H: 72,               // cada 3 días: se retiran los peores y nacen nuevos
  JUZGAR_H: 72,              // horas mínimas para juzgar a un alumno
  RETIRA: 0.25,              // parte de los juzgados que se retira en cada ronda (los de peor t)
  SALVA_T: 1,                // quien va con t ≥ 1 no se retira aunque esté entre los peores
  CURIOSIDAD: 1 / 3,         // de las plazas libres, cuántas van a ideas nuevas (el resto, hijos de los mejores)
  QUIEBRA: Math.log(0.5),    // pierde la mitad de su dinero de prácticas: se retira por quiebra
  GRADUA_H: 720,
  GRADUA_DSR: 0.95,
  MAX_GRADUADOS: 4,
  MAX_RETIRADOS: 80,
  // v2.8.0: trabajo en equipo
  EQUIPO_ETA: 10,            // cuánto se mueve el peso de cada alumno en el equipo según lo que gana o pierde cada hora
  EQUIPO_REPARTO: 0.001,     // reparto fijo: nadie se queda en cero, para poder volver a confiar en él
  MENTOR: 0.25,              // de los hijos, cuántos toman la idea de un buen alumno del otro grupo (con el riesgo de su grupo)
};
// las estrategias del sistema en la gramática común (la del laboratorio): de ahí parten los primeros alumnos
const PR_BASES = [
  { senal: 'cruce', a: 12, b: 72 }, { senal: 'cruce', a: 24, b: 168 }, { senal: 'cruce', a: 72, b: 336 }, { senal: 'cruce', a: 168, b: 720 },
  { senal: 'cruce', a: 24, b: 168, lado: 'largos' }, { senal: 'cruce', a: 168, b: 720, lado: 'largos' },
  { senal: 'impulso', a: 24 }, { senal: 'impulso', a: 168 }, { senal: 'impulso', a: 720 },
  { senal: 'rebote', a: 12 }, { senal: 'rebote', a: 24, forma: 'continua', k: 2 },
  { senal: 'funding_contra', a: 24 }, { senal: 'tendencia_mixta', a: 12, b: 720 },
].map((x) => ({ forma: 'signo', modo: 'serie', lado: 'ambos', filtro: 'ninguno', cada: 1, ...x }));

function prRng(P) { // mulberry32 con el estado guardado: la misma historia da los mismos alumnos
  const a = (P.semilla = (P.semilla + 0x6D2B79F5) >>> 0);
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const prElige = (P, xs) => xs[Math.min(xs.length - 1, Math.floor(prRng(P) * xs.length))];
function prLimpia(sp) {
  const o = { senal: sp.senal, a: sp.a, forma: sp.forma, modo: sp.modo, lado: sp.lado, filtro: sp.filtro, cada: sp.cada };
  if (sp.b != null) o.b = sp.b;
  if (sp.forma === 'continua') o.k = sp.k;
  return o;
}
const prClave = (sp, r, c) => apLabIdent(sp) + '_x' + r + (c ? '_c' + c : '');
const prNombre = (A) => apLabNombre(A.spec) + (A.conc === 1 ? ', todo en 1 moneda' : A.conc ? ', en ' + A.conc + ' monedas' : '') + ' ×' + A.riesgo;
const prGrupo = (A) => A.grupo || 'normal';
const prCupo = (g) => (g === 'arriesgado' ? PR.ARRIESGADOS : PR.ALUMNOS);
function prValido(sp, riesgo, conc, grupo) {
  if (!apLabValida(sp)) return false;
  if (grupo === 'arriesgado') return PR.RIESGOS_ALTOS.includes(riesgo) && (conc == null || PR.CONC.includes(conc)) && (riesgo >= 5 || conc != null);
  return PR.RIESGOS.includes(riesgo) && conc == null;
}
// riesgo y concentración al azar para el grupo arriesgado
function prRiesgoAlto(P) {
  const conc = prElige(P, [null, null, 3, 1]);
  const riesgo = conc ? prElige(P, PR.RIESGOS_ALTOS) : prElige(P, [5, 10]);
  return [riesgo, conc];
}
const prVecindario = (sp) => [sp.senal, sp.a, sp.b || '', sp.lado, sp.filtro].join('_');
function prT(A) { const m = apMomentos(A.st); return m.sr * Math.sqrt(m.n); }
function prAzar(P) {
  const senal = prElige(P, ['cruce', 'cruce', 'impulso', 'rebote', 'funding_contra', 'funding_sigue', 'tendencia_mixta']);
  const sp = { senal, forma: prRng(P) < 0.6 ? 'signo' : 'continua', modo: prElige(P, ['serie', 'seccion']), lado: prElige(P, ['ambos', 'largos', 'cortos']),
    filtro: prElige(P, ['ninguno', 'ninguno', 'btc_alcista', 'btc_bajista']), cada: prRng(P) < 0.7 ? 1 : 24 };
  if (senal === 'tendencia_mixta') { sp.a = 12; sp.b = 720; }
  else if (senal.startsWith('funding')) sp.a = prElige(P, [24, 168]);
  else if (senal === 'cruce') { const i = Math.floor(prRng(P) * (AP.SPANS.length - 1)); sp.a = AP.SPANS[i]; sp.b = prElige(P, AP.SPANS.slice(i + 1)); }
  else sp.a = prElige(P, AP.SPANS);
  if (sp.forma === 'continua') sp.k = prElige(P, [0.5, 1, 2]);
  return prLimpia(sp);
}
function prMuta(P, sp0) { // un solo cambio respecto al padre
  const sp = { ...sp0 };
  const vecino = (lista, x, d) => lista[Math.max(0, Math.min(lista.length - 1, lista.indexOf(x) + d))];
  const d = prElige(P, ['a', 'b', 'forma', 'modo', 'lado', 'filtro', 'cada']);
  const paso = prRng(P) < 0.5 ? -1 : 1;
  if (d === 'a') {
    if (sp.senal.startsWith('funding')) sp.a = sp.a === 24 ? 168 : 24;
    else if (sp.senal !== 'tendencia_mixta') { sp.a = vecino(AP.SPANS, sp.a, paso); if (sp.senal === 'cruce' && !(sp.b > sp.a)) sp.b = vecino(AP.SPANS, sp.a, 1); }
  } else if (d === 'b' && sp.senal === 'cruce') { const b = vecino(AP.SPANS, sp.b, paso); if (b > sp.a) sp.b = b; }
  else if (d === 'forma') { if (sp.forma === 'signo') { sp.forma = 'continua'; sp.k = prElige(P, [0.5, 1, 2]); } else if (prRng(P) < 0.5) { sp.forma = 'signo'; delete sp.k; } else sp.k = prElige(P, [0.5, 1, 2].filter((k) => k !== sp.k)); }
  else if (d === 'modo') sp.modo = sp.modo === 'serie' ? 'seccion' : 'serie';
  else if (d === 'lado') sp.lado = prElige(P, ['ambos', 'largos', 'cortos'].filter((x) => x !== sp.lado));
  else if (d === 'filtro') sp.filtro = prElige(P, ['ninguno', 'btc_alcista', 'btc_bajista'].filter((x) => x !== sp.filtro));
  else if (d === 'cada') sp.cada = sp.cada === 1 ? 24 : 1;
  return prLimpia(sp);
}
function prNace(P, spec, riesgo, t, padre, origen, grupo = 'normal', conc = null) {
  const sp = prLimpia(spec);
  const A = { id: 'p' + (++P.serie), spec: sp, riesgo, conc, grupo, nace: t, padre: padre ? padre.id : null, padreNombre: padre ? prNombre(padre) : null,
    gen: padre ? (padre.gen || 1) + 1 : 1, origen, st: apStats(), pos: {}, coste: 0, tUlt: null };
  P.alumnos.push(A); P.probadas++;
  const v = prVecindario(sp); P.mapa[v] = (P.mapa[v] || 0) + 1;
  return A;
}
// una plaza libre de un grupo: hijo de uno de sus mejores (con un cambio, u otro riesgo o concentración) o una idea nueva
// lejos de lo ya probado
function prUnoNuevo(P, t, maestros, grupo = 'normal') {
  const vivas = new Set(P.alumnos.map((A) => prClave(A.spec, A.riesgo, A.conc)));
  const alto = grupo === 'arriesgado';
  for (let intento = 0; intento < 40; intento++) {
    if (maestros.length && prRng(P) >= PR.CURIOSIDAD) {
      const otro = maestros.filter((A) => prGrupo(A) !== grupo), mios = maestros.filter((A) => prGrupo(A) === grupo);
      if (otro.length && (!mios.length || prRng(P) < PR.MENTOR)) { // se pasan ideas: la misma idea, con el riesgo de este grupo
        const padre = prElige(P, otro);
        const [riesgo, conc] = alto ? prRiesgoAlto(P) : [prElige(P, [1, 2]), null];
        if (!prValido(padre.spec, riesgo, conc, grupo) || vivas.has(prClave(padre.spec, riesgo, conc))) continue;
        return prNace(P, padre.spec, riesgo, t, padre, 'compañero', grupo, conc);
      }
      const padre = prElige(P, mios.length ? mios : maestros);
      let riesgo = padre.riesgo, conc = padre.conc == null ? null : padre.conc;
      if (prRng(P) < 0.25) { if (alto) [riesgo, conc] = prRiesgoAlto(P); else riesgo = prElige(P, PR.RIESGOS.filter((r) => r !== padre.riesgo)); }
      const cambiaRiesgo = riesgo !== padre.riesgo || conc !== (padre.conc == null ? null : padre.conc);
      const sp = cambiaRiesgo && prRng(P) < 0.5 ? padre.spec : prMuta(P, padre.spec);
      if (!prValido(sp, riesgo, conc, grupo) || vivas.has(prClave(sp, riesgo, conc))) continue;
      return prNace(P, sp, riesgo, t, padre, 'hijo', grupo, conc);
    }
    let mejor = null, menos = Infinity; // curiosidad: de 12 ideas al azar, la del vecindario menos probado
    for (let k = 0; k < 12; k++) {
      const sp = prAzar(P);
      const [r, c] = alto ? prRiesgoAlto(P) : [prElige(P, PR.RIESGOS), null];
      if (!prValido(sp, r, c, grupo) || vivas.has(prClave(sp, r, c))) continue;
      const n = (P.mapa[prVecindario(sp)] || 0) + prRng(P) * 0.5;
      if (n < menos) { menos = n; mejor = [sp, r, c]; }
    }
    if (mejor) return prNace(P, mejor[0], mejor[1], t, null, 'curiosidad', grupo, mejor[2]);
  }
  return null;
}
// primeros arriesgados: las estrategias del sistema con ×5 o ×10, o concentradas, y algunas ideas nuevas
function prSembrarArriesgados(P, t) {
  const ya = () => new Set(P.alumnos.map((A) => prClave(A.spec, A.riesgo, A.conc)));
  for (let i = 0, intentos = 0; i < Math.round(PR.ARRIESGADOS * 2 / 3) && intentos < 60; intentos++) {
    const b = prElige(P, PR_BASES), [r, c] = prRiesgoAlto(P);
    if (!prValido(b, r, c, 'arriesgado') || ya().has(prClave(prLimpia(b), r, c))) continue;
    prNace(P, b, r, t, null, 'arriesgado', 'arriesgado', c); i++;
  }
  while (P.alumnos.filter((A) => prGrupo(A) === 'arriesgado').length < PR.ARRIESGADOS) if (!prUnoNuevo(P, t, [], 'arriesgado')) break;
}
function prNuevo(t) {
  const P = { v: 2, creado: t, semilla: (t / H1) >>> 0, serie: 0, probadas: 0, rondas: 0, ronda: t, t: null, alumnos: [], retirados: [],
    cuenta: { retirados: 0, quiebras: 0 }, lecciones: {}, mapa: {}, graduados: [] };
  for (const b of PR_BASES) prNace(P, b, 1, t, null, 'base');
  const bases = P.alumnos.slice();
  for (let i = 0; i < 6; i++) { // las mismas estrategias, arriesgando más
    const b = prElige(P, bases), r = prElige(P, [2, 3]);
    if (!P.alumnos.some((A) => prClave(A.spec, A.riesgo, A.conc) === prClave(b.spec, r, null))) prNace(P, b.spec, r, t, b, 'más riesgo');
  }
  while (P.alumnos.length < PR.ALUMNOS) if (!prUnoNuevo(P, t, [])) break;
  prSembrarArriesgados(P, t);
  return P;
}
const PR_ASPECTOS = {
  grupo: ['Grupo', (A) => prGrupo(A), { normal: 'Normales', arriesgado: 'Arriesgados' }],
  riesgo: ['Riesgo', (A) => A.riesgo, { 1: '×1 (prudente)', 2: '×2', 3: '×3', 5: '×5', 10: '×10 (muy arriesgado)' }],
  conc: ['Concentración', (A) => A.conc || 'no', { no: 'Repartido entre monedas', 3: 'En 3 monedas', 1: 'Todo en 1 moneda' }],
  senal: ['Idea', (A) => A.spec.senal, { cruce: 'Cruce de medias', impulso: 'Impulso', rebote: 'Rebote', funding_contra: 'Contra el funding', funding_sigue: 'A favor del funding', tendencia_mixta: 'Tendencia mixta' }],
  plazo: ['Plazo', (A) => A.spec.a, { 12: '12 h', 24: '1 día', 72: '3 días', 168: '1 semana', 336: '2 semanas', 720: '1 mes' }],
  lado: ['Lado', (A) => A.spec.lado, { ambos: 'Compra y vende', largos: 'Solo compras', cortos: 'Solo ventas' }],
  filtro: ['Filtro', (A) => A.spec.filtro, { ninguno: 'Siempre', btc_alcista: 'Solo si BTC sube', btc_bajista: 'Solo si BTC baja' }],
  modo: ['Modo', (A) => A.spec.modo, { serie: 'Cada moneda por su cuenta', seccion: 'Relativa entre monedas' }],
  forma: ['Forma', (A) => A.spec.forma, { signo: 'Todo o nada', continua: 'Proporcional' }],
  cada: ['Reajuste', (A) => A.spec.cada, { 1: 'Cada hora', 24: 'Una vez al día' }],
};
function prAnota(L, A, quiebra) { // lo que deja cada alumno juzgado al retirarse
  const tt = prT(A);
  for (const [k, [, f]] of Object.entries(PR_ASPECTOS)) {
    const v = String(f(A));
    const x = ((L[k] = L[k] || {})[v] = L[k][v] || { n: 0, sumaT: 0, quiebras: 0, horas: 0 });
    x.n++; x.sumaT += tt; x.horas += A.st.n; if (quiebra) x.quiebras++;
  }
}
function prFicha(A, t) {
  const m = apMomentos(A.st);
  return { id: A.id, alumno: prNombre(A), grupo: prGrupo(A) === 'arriesgado' ? 'arriesgado' : 'normal', riesgo: A.riesgo, concentracion: A.conc || null, origen: A.origen, generacion: A.gen || 1, padre: A.padreNombre || null, nace: iso(A.nace), fin: t != null ? iso(t) : null,
    horas: m.n, rentPct: (Math.exp(A.st.log) - 1) * 100, tStat: m.sr * Math.sqrt(m.n), caidaMaxPct: A.st.dd * 100 };
}
function prRetira(P, A, t, motivo) {
  P.alumnos = P.alumnos.filter((x) => x !== A);
  const quiebra = motivo === 'quiebra';
  if (quiebra || A.st.n >= PR.JUZGAR_H) prAnota(P.lecciones, A, quiebra);
  P.retirados.push({ ...prFicha(A, t), spec: A.spec, motivo });
  if (P.retirados.length > PR.MAX_RETIRADOS) P.retirados.splice(0, P.retirados.length - PR.MAX_RETIRADOS);
  P.cuenta.retirados++; if (quiebra) P.cuenta.quiebras++;
  const g = (P.cuenta.grupos = P.cuenta.grupos || {})[prGrupo(A)] || (P.cuenta.grupos[prGrupo(A)] = { retirados: 0, quiebras: 0 });
  g.retirados++; if (quiebra) g.quiebras++;
}
function prMaestros(P, grupo = 'normal') {
  const vivos = P.alumnos.filter((A) => prGrupo(A) === grupo);
  const j = vivos.filter((A) => A.st.n >= PR.JUZGAR_H).sort((a, b) => prT(b) - prT(a));
  if (!j.length) return vivos;
  const top = j.slice(0, Math.max(1, Math.ceil(j.length / 4)));
  return top.some((A) => prT(A) > 0) ? top.filter((A) => prT(A) > 0) : top;
}
function prRellena(P, t) {
  for (const g of ['normal', 'arriesgado']) {
    // sus mejores y, como mentores, los dos mejores juzgados del otro grupo que ganan
    const otro = g === 'normal' ? 'arriesgado' : 'normal';
    const mentores = P.alumnos.filter((A) => prGrupo(A) === otro && A.st.n >= PR.JUZGAR_H && prT(A) > 0).sort((a, b) => prT(b) - prT(a)).slice(0, 2);
    const maestros = prMaestros(P, g).concat(mentores);
    while (P.alumnos.filter((A) => prGrupo(A) === g).length < prCupo(g)) if (!prUnoNuevo(P, t, maestros, g)) break;
  }
}
function prRonda(P, t) { // cada grupo compite por separado
  let fuera = 0;
  for (const g of ['normal', 'arriesgado']) {
    const juzgados = P.alumnos.filter((A) => prGrupo(A) === g && A.st.n >= PR.JUZGAR_H).sort((a, b) => prT(a) - prT(b));
    if (juzgados.length < 4) continue;
    const n = Math.max(1, Math.floor(juzgados.length * PR.RETIRA));
    for (const A of juzgados.slice(0, n)) if (prT(A) < PR.SALVA_T && !A.graduado) { prRetira(P, A, t, 'ronda'); fuera++; }
  }
  P.rondas++; P.ronda = t;
  return fuera;
}
// Sharpe deflactado de los alumnos con más de un mes: el listón sube con el nº total de alumnos que han existido.
function prGraduar(E, P, t) {
  const salen = [];
  const juzgados = P.alumnos.filter((A) => A.st.n > PR.JUZGAR_H);
  if (!juzgados.some((A) => A.st.n >= PR.GRADUA_H)) return salen;
  const srs = juzgados.map((A) => apMomentos(A.st).sr);
  const ms = srs.reduce((a, b) => a + b, 0) / srs.length;
  const V = srs.length > 1 ? srs.reduce((a, b) => a + (b - ms) * (b - ms), 0) / (srs.length - 1) : 0;
  const N = Math.max(P.probadas, AP.PRUEBAS, 2), g = 0.5772156649;
  const eMax = (1 - g) * apPhiInv(1 - 1 / N) + g * apPhiInv(1 - 1 / (N * Math.E)); // máximo esperado de N pruebas sin ventaja
  const sr0 = Math.sqrt(V) * eMax;
  for (const A of juzgados) {
    if (A.graduado || A.st.n < PR.GRADUA_H) continue;
    const { n, sr, sk, ku } = apMomentos(A.st);
    const den = Math.sqrt(Math.max(1e-12, 1 - sk * sr + ((ku - 1) / 4) * sr * sr));
    // los vivos son supervivientes de las rondas: su dispersión infravalora la de todas las pruebas; como mínimo, la del
    // Sharpe estimado de un alumno sin ventaja con estas horas (1/n)
    const liston = Math.max(sr0, Math.sqrt(1 / n) * eMax);
    const dsr = apPhi(((sr - liston) * Math.sqrt(n - 1)) / den);
    A.dsr = dsr;
    if (!(dsr > PR.GRADUA_DSR && sr > 0)) continue;
    A.graduado = t;
    const id = 'grad_' + apLabIdent(A.spec);
    P.graduados.push({ id, alumno: prNombre(A), t: iso(t), dsr, horas: n });
    E.graduados = E.graduados || [];
    const ocupado = AP_EXPERTOS.some((ex) => ex.id === id) || E.graduados.some((x) => x.id === id) || ((E.lab && E.lab.specs) || []).some((x) => x.spec && apLabIdent(x.spec) === apLabIdent(A.spec));
    if (!ocupado && !A.conc && E.graduados.length < PR.MAX_GRADUADOS) { // el sistema no sabe concentrar: esos se estudian aparte
      E.graduados.push({ id, nombre: apLabNombre(A.spec), spec: A.spec, t });
      apAlerta(E, t, 'graduado', id, 'Se gradúa en la zona de prácticas y entra a competir con poco peso: ' + prNombre(A) + ' (Sharpe deflactado ' + dsr.toFixed(2) + ' con ' + n + ' h; ' + P.probadas + ' alumnos probados)');
    }
    salen.push(prNombre(A));
  }
  return salen;
}
function prFoto(E) {
  const px = {}, f = {};
  for (const [m, c] of Object.entries(E.monedas || {})) { if (c.px > 0) px[m] = c.px; f[m] = c.f || 0; }
  return { t: E.t, px, f };
}
// Una hora en vivo, después de apPaso. antes = precios y funding con los que empezó la hora (prFoto antes de apPaso).
// ---- el equipo (v2.8.0): todos los alumnos votan una cartera común; pesa más quien más acierta ----
// Pesos multiplicativos sobre lo que gana cada alumno por unidad de riesgo (su resultado / su ×), con un reparto fijo.
// La cartera del equipo es la media ponderada de las posiciones de los alumnos divididas por su ×: como mucho el 100 %.
function prEquipoNuevo(t) { return { lw: {}, st: apStats(), pos: {}, coste: 0, tUlt: null, desde: t }; }
function prEquipoPesos(Q, ids) {
  const v = ids.filter((id) => Q.lw[id] != null);
  const s = v.reduce((a, id) => a + Math.exp(Q.lw[id]), 0);
  const w = {};
  for (const id of v) w[id] = s > 0 ? Math.exp(Q.lw[id]) / s : 0;
  return w;
}
function prEquipoAprende(P, r) { // r: {id: resultado de la hora por unidad de riesgo}
  const Q = P.equipo, ids = P.alumnos.map((A) => A.id);
  for (const id of Object.keys(Q.lw)) if (!ids.includes(id)) delete Q.lw[id]; // los que se fueron
  const conPeso = ids.filter((id) => Q.lw[id] != null);
  const media = conPeso.length ? Math.log(conPeso.reduce((a, id) => a + Math.exp(Q.lw[id]), 0) / conPeso.length) : 0;
  for (const id of ids) if (Q.lw[id] == null) Q.lw[id] = media; // los nuevos entran con el peso medio
  for (const id of ids) if (r[id] != null) Q.lw[id] += PR.EQUIPO_ETA * Math.log(1 + Math.max(r[id], -0.99));
  const w = prEquipoPesos(Q, ids), N = ids.length;
  for (const id of ids) Q.lw[id] = Math.log((1 - PR.EQUIPO_REPARTO) * w[id] + PR.EQUIPO_REPARTO / N);
  const mx = Math.max(...ids.map((id) => Q.lw[id]));
  for (const id of ids) Q.lw[id] -= mx;
}
function prEquipoVota(P) {
  const Q = P.equipo, w = prEquipoPesos(Q, P.alumnos.map((A) => A.id));
  const pos = {};
  for (const A of P.alumnos) { const k = (w[A.id] || 0) / A.riesgo; if (!k) continue; for (const [m, q] of Object.entries(A.pos)) pos[m] = (pos[m] || 0) + k * q; }
  for (const m of Object.keys(pos)) if (Math.abs(pos[m]) < 1e-6) delete pos[m];
  Q.coste = apGiro(pos, Q.pos) * AP.COMISION;
  Q.pos = pos;
  return w;
}

// Arriesgado concentrado: las 'conc' monedas de señal más fuerte entre las que la estrategia operaría, con todo el riesgo
// repartido entre ellas y sin ajustar por volatilidad.
function prConcentra(E, A, base) {
  const ms = Object.keys(base).filter((m) => base[m]);
  if (!ms.length) return {};
  const x = {};
  for (const m of ms) { const v = apLabBruto(A.spec, E.monedas[m]); x[m] = Number.isFinite(v) ? v : 0; }
  if (A.spec.modo === 'seccion') { const media = ms.reduce((a, m) => a + x[m], 0) / ms.length; for (const m of ms) x[m] -= media; }
  const elegidas = ms.sort((a, b) => Math.abs(x[b]) - Math.abs(x[a]) || (a < b ? -1 : 1)).slice(0, A.conc);
  const pos = {};
  for (const m of elegidas) pos[m] = Math.sign(base[m]) * A.riesgo / elegidas.length;
  return pos;
}
function prPaso(E, P, snap, antes) {
  const t = snap.t;
  if ((P.v || 1) < 2) { // v2.6.1: los alumnos de antes son el grupo normal y nace el grupo arriesgado
    for (const A of P.alumnos) { A.grupo = A.grupo || 'normal'; if (A.conc === undefined) A.conc = null; }
    P.v = 2;
    prSembrarArriesgados(P, t);
  }
  if (!P.equipo) P.equipo = prEquipoNuevo(t); // v2.8.0
  const horas = antes.t == null ? 1 : Math.max(1, Math.round((t - antes.t) / H1));
  const out = { quiebras: [], graduados: [], retirados: 0 };
  const porRiesgo = {};
  const resultado = (pos) => { let r = 0; for (const [m, q] of Object.entries(pos)) { const a = antes.px[m], b = snap.px[m]; if (a > 0 && b > 0) r += q * (b / a - 1 - (antes.f[m] || 0) * horas); } return r; };
  for (const A of P.alumnos) { // 1) cobrar o pagar la hora que acaba
    if (A.tUlt == null) continue;
    let r = resultado(A.pos);
    r -= A.coste || 0; A.coste = 0;
    apSuma(A.st, Math.max(-0.99, r));
    porRiesgo[A.id] = r / A.riesgo;
  }
  const Q = P.equipo;
  if (Q.tUlt != null) { apSuma(Q.st, Math.max(-0.99, resultado(Q.pos) - (Q.coste || 0))); Q.coste = 0; } // el equipo cobra su hora
  prEquipoAprende(P, porRiesgo);
  for (const A of P.alumnos.slice()) if (A.st.log <= PR.QUIEBRA) { out.quiebras.push(prNombre(A)); prRetira(P, A, t, 'quiebra'); } // 2) quiebras
  if (t - P.ronda >= PR.RONDA_H * H1) out.retirados = prRonda(P, t); // 3) ronda
  prRellena(P, t);
  const listas = AP.MERCADOS.filter((m) => E.monedas[m] && E.monedas[m].n >= AP.HORAS_MIN && snap.px[m] > 0);
  for (const A of P.alumnos) { // 4) posiciones nuevas
    const sp = A.spec;
    let nueva;
    if (sp.cada > 1 && A.tUlt != null && Math.floor(t / H1) % sp.cada !== 0) nueva = A.pos;
    else {
      const base = apLabPosiciones(E, { id: '__practicas', spec: sp }, listas, t) || {};
      nueva = {};
      if (A.conc) nueva = prConcentra(E, A, base);
      else for (const [m, q] of Object.entries(base)) nueva[m] = q * A.riesgo;
      const objetivo = { ...nueva };
      for (const m of Object.keys(nueva)) { const o = A.pos[m]; if (o && Math.sign(o) === Math.sign(nueva[m]) && Math.abs(nueva[m] - o) < AP.BANDA * Math.abs(o)) nueva[m] = o; }
      if (Object.values(nueva).reduce((a, b) => a + Math.abs(b), 0) > A.riesgo + 1e-9) Object.assign(nueva, objetivo);
    }
    A.coste = apGiro(nueva, A.pos) * AP.COMISION;
    A.pos = nueva; A.tUlt = t;
  }
  prEquipoAprende(P, {}); // los que acaban de entrar, con el peso medio
  prEquipoVota(P); Q.tUlt = t; // el equipo vota su cartera
  E.equipo = { t, pos: { ...Q.pos } }; // y la ofrece al sistema principal (experto «equipo_practicas»)
  out.graduados = prGraduar(E, P, t); // 5) graduación
  P.t = t;
  return out;
}
async function prCargar(env) {
  const fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('practicas').first();
  return fila ? JSON.parse(fila.json) : null;
}
async function prGuardar(env, P) {
  await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('practicas', JSON.stringify(P), P.t || Date.now()).run();
}
const PR_MOTIVOS = { quiebra: 'Quebró: perdió la mitad de su dinero de prácticas', ronda: 'Retirado: de los peores de su ronda' };
function prEstado(A) {
  if (A.graduado) return 'graduado';
  if (A.st.n < PR.JUZGAR_H) return 'empezando';
  const tt = prT(A);
  return tt >= 1 ? 'va bien' : tt <= -1 ? 'va mal' : 'sin ventaja clara';
}
function prLecciones(P) {
  const L = JSON.parse(JSON.stringify(P.lecciones || {}));
  for (const A of P.alumnos) if (A.st.n >= PR.JUZGAR_H) prAnota(L, A, false);
  const rows = [];
  for (const [k, [aspecto, , nombres]] of Object.entries(PR_ASPECTOS)) {
    for (const [v, x] of Object.entries(L[k] || {})) rows.push({ aspecto, valor: nombres[v] || v, alumnos: x.n, tMedia: x.n ? x.sumaT / x.n : 0, quiebras: x.quiebras, horas: x.horas });
  }
  const frases = [];
  for (const [, [aspecto]] of Object.entries(PR_ASPECTOS)) {
    const xs = rows.filter((r) => r.aspecto === aspecto && r.alumnos >= 3).sort((a, b) => b.tMedia - a.tMedia);
    if (xs.length < 2) continue;
    const a = xs[0], b = xs[xs.length - 1];
    frases.push({ aspecto, diferencia: a.tMedia - b.tMedia, texto: aspecto + ': «' + a.valor + '» va mejor (t media ' + conSigno(a.tMedia, 1) + ' en ' + a.alumnos + ') que «' + b.valor + '» (' + conSigno(b.tMedia, 1) + ' en ' + b.alumnos + (b.quiebras ? '; ' + b.quiebras + ' quiebras' : '') + ').' });
  }
  frases.sort((a, b) => b.diferencia - a.diferencia);
  rows.sort((a, b) => (a.aspecto === b.aspecto ? b.tMedia - a.tMedia : 0));
  return { rows, frases: frases.slice(0, 5).map((f) => f.texto) };
}
async function prVista(env, v) {
  await apTablas(env);
  const P = await prCargar(env);
  if (!P) return { rows: [], nota: 'La zona de prácticas abre en la próxima hora en vivo.' };
  const nota = 'Zona de prácticas, en papel: ' + PR.ALUMNOS + ' alumnos normales (variantes de las estrategias del sistema, con riesgo ×1, ×2 o ×3) y ' + PR.ARRIESGADOS + ' arriesgados (×5 o ×10, o todo en 1 o 3 monedas sin ajustar por volatilidad; cada grupo compite por separado) practican cada hora con su propio dinero de prácticas, con comisiones y funding. Cada ' + PR.RONDA_H + ' h se retira la cuarta parte peor de los que llevan ' + PR.JUZGAR_H + ' h (salvo los que van con t ≥ ' + PR.SALVA_T + '); quien pierde la mitad, quiebra. Las plazas libres son para hijos de los mejores (un cambio), para ideas que funcionan en el otro grupo (con el riesgo de este) o para ideas nuevas lejos de lo ya probado. Trabajan en equipo: todos votan una cartera común en la que pesa más quien más acierta por unidad de riesgo; esa cartera compite también en el sistema principal. Se gradúa quien gana un mes en vivo con un Sharpe deflactado de más de ' + PR.GRADUA_DSR + ' contando todos los alumnos que han existido; entonces entra en el sistema con poco peso. tStat: t de su rentabilidad hora a hora (por encima de 2, poco probable que sea suerte). No mueve dinero ni es una recomendación.';
  if (v === 'practicas_retirados') return { rows: P.retirados.slice().reverse().map((r) => ({ ...r, motivo: PR_MOTIVOS[r.motivo] || r.motivo, spec: undefined })), nota };
  if (v === 'practicas_lecciones') { const L = prLecciones(P); return { rows: L.rows, frases: L.frases, nota: 'Lo que dejan los alumnos juzgados (al menos ' + PR.JUZGAR_H + ' h), vivos y retirados, agrupado por cada decisión. Con pocos alumnos o pocas horas, las diferencias pueden ser suerte.' }; }
  const wEq = P.equipo ? prEquipoPesos(P.equipo, P.alumnos.map((A) => A.id)) : {};
  const filas = P.alumnos.map((A) => ({ ...prFicha(A, null), estado: prEstado(A), dsr: A.dsr == null ? null : A.dsr, pesoEquipoPct: (wEq[A.id] || 0) * 100 })).sort((a, b) => (b.horas >= PR.JUZGAR_H) - (a.horas >= PR.JUZGAR_H) || b.tStat - a.tStat);
  const proxima = P.ronda + PR.RONDA_H * H1;
  const gr = (P.cuenta.grupos || {}).arriesgado || { retirados: 0, quiebras: 0 };
  let equipo = null;
  if (P.equipo) {
    const Q = P.equipo, mq = apMomentos(Q.st);
    const pesan = P.alumnos.map((A) => ({ alumno: prNombre(A), id: A.id, pesoPct: (wEq[A.id] || 0) * 100 })).sort((a, b) => b.pesoPct - a.pesoPct).slice(0, 3);
    const juz = P.alumnos.filter((A) => A.st.n > 0);
    const mediaAlumnos = juz.length ? juz.reduce((a, A) => a + (Math.exp(A.st.log) - 1) * 100 / A.riesgo, 0) / juz.length : null;
    equipo = { desde: iso(Q.desde), horas: mq.n, rentPct: (Math.exp(Q.st.log) - 1) * 100, tStat: mq.sr * Math.sqrt(mq.n), caidaMaxPct: Q.st.dd * 100, exposicionPct: Object.values(Q.pos).reduce((a, b) => a + Math.abs(b), 0) * 100, mediaAlumnosPorRiesgoPct: mediaAlumnos, quienesPesan: pesan };
  }
  return { rows: filas, equipo, resumen: { alumnos: P.alumnos.length, arriesgados: P.alumnos.filter((A) => prGrupo(A) === 'arriesgado').length, retiradosArriesgados: gr.retirados, quiebrasArriesgados: gr.quiebras, probadas: P.probadas, rondas: P.rondas, proximaRonda: iso(proxima), retirados: P.cuenta.retirados, quiebras: P.cuenta.quiebras, graduados: P.graduados, abierta: iso(P.creado), hasta: P.t ? iso(P.t) : null }, nota };
}

// ---------- cazadores de funding (v2.9.0) ----------
// Un equipo de 8 cazadores que buscan cada hora, entre todos los perpetuos de Hyperliquid con liquidez, a quienes pagan
// demasiado por estar apalancados. Los «cubiertos» venden el perpetuo y compran lo mismo al contado: no dependen del precio
// y cobran el funding (como el experto «carry», con su mismo coste). Los «sin cubrir» apuestan contra el exceso: venden
// cuando los compradores pagan demasiado y compran cuando pagan los vendedores. Usan los datos que ya llegan en la hora en
// vivo (sin peticiones de más). Trabajan en equipo: pesa más quien más gana. Todo en papel. Supuesto a vigilar: en monedas
// pequeñas no siempre hay contado para cubrirse.
const CZ = {
  E24: 2 / 25,        // media móvil de unas 24 h del funding de cada mercado
  ETA: 10,
  REPARTO: 0.001,
  MAX_MERCADO: 15,    // filas de la vista de mercados
};
const CZ_CAZADORES = [
  { id: 'cz_cob_20', nombre: 'Cubierto: las 5 que más pagan (desde 20 % al año)', modo: 'cubierto', entra: 0.2, sale: 0.1, k: 5, vol: 1e6 },
  { id: 'cz_cob_50', nombre: 'Cubierto: las 3 que más pagan (desde 50 % al año)', modo: 'cubierto', entra: 0.5, sale: 0.2, k: 3, vol: 1e6 },
  { id: 'cz_cob_100', nombre: 'Cubierto: solo extremos (desde 100 % al año)', modo: 'cubierto', entra: 1.0, sale: 0.4, k: 3, vol: 1e6 },
  { id: 'cz_cob_liq', nombre: 'Cubierto: las 10 que más pagan entre las muy líquidas (más de 5 M$ al día)', modo: 'cubierto', entra: 0.1, sale: 0.05, k: 10, vol: 5e6 },
  { id: 'cz_cob_const', nombre: 'Cubierto: solo si pagan de forma constante (media de 24 h desde 30 %)', modo: 'cubierto', entra: 0.3, sale: 0.15, k: 5, vol: 1e6, media: true },
  { id: 'cz_contra_compra', nombre: 'Sin cubrir: vende cuando los compradores pagan demasiado (desde 100 % al año)', modo: 'contra', lado: 'largos', entra: 1.0, sale: 0.3, k: 3, vol: 1e6 },
  { id: 'cz_contra_venta', nombre: 'Sin cubrir: compra cuando los vendedores pagan demasiado (desde −50 % al año)', modo: 'contra', lado: 'cortos', entra: 0.5, sale: 0.15, k: 3, vol: 1e6 },
  { id: 'cz_contra_ambos', nombre: 'Sin cubrir: contra los excesos de los dos lados (desde 75 % al año)', modo: 'contra', lado: 'ambos', entra: 0.75, sale: 0.25, k: 5, vol: 1e6 },
];
function czNuevo(t) {
  const cz = {};
  for (const c of CZ_CAZADORES) cz[c.id] = { pos: {}, st: apStats(), coste: 0, tUlt: null };
  return { v: 1, creado: t, t: null, px: {}, f: {}, e24: {}, n: {}, cz, eq: { lw: {}, st: apStats() } };
}
// Lo que trae la hora en vivo (metaAndAssetCtxs del dex principal): precio, funding horario y volumen de cada perpetuo.
function czMercados(meta, ctxs) {
  const out = {};
  ((meta && meta.universe) || []).forEach((a, i) => {
    const c = ctxs && ctxs[i];
    if (!c || a.isDelisted) return;
    const px = num(c.markPx), f = num(c.funding), vol = num(c.dayNtlVlm);
    if (!(px > 0) || f == null || !Number.isFinite(f)) return;
    out[a.name] = { px, f, vol: Number.isFinite(vol) ? vol : 0 };
  });
  return out;
}
// Funding anual que mira cada cazador: el de ahora o, si lo pide, la media de 24 h.
const czAnual = (C, c, m, M) => (c.media ? (C.n[m] >= 12 ? C.e24[m] : null) : M[m].f) * 8760;
function czElige(C, c, M, pos0) {
  const dentro = (m) => {
    const fa = czAnual(C, c, m, M);
    if (fa == null || M[m].vol < c.vol) return 0;
    if (c.modo === 'cubierto') return fa >= c.entra ? 2 : fa >= c.sale ? 1 : 0;
    if (c.lado === 'largos') return fa >= c.entra ? 2 : fa >= c.sale ? 1 : 0;
    if (c.lado === 'cortos') return fa <= -c.entra ? 2 : fa <= -c.sale ? 1 : 0;
    return Math.abs(fa) >= c.entra ? 2 : Math.abs(fa) >= c.sale ? 1 : 0;
  };
  const lado = (m) => (c.modo === 'cubierto' ? 1 : -Math.sign(czAnual(C, c, m, M)));
  // se quedan los que siguen por encima del umbral de salida (y en el mismo lado); se llenan las plazas con los que más pagan
  const siguen = Object.keys(pos0).filter((m) => M[m] && dentro(m) >= 1 && (c.modo === 'cubierto' || Math.sign(pos0[m]) === lado(m)));
  const nuevos = Object.keys(M).filter((m) => !siguen.includes(m) && dentro(m) === 2).sort((a, b) => Math.abs(czAnual(C, c, b, M)) - Math.abs(czAnual(C, c, a, M)) || (a < b ? -1 : 1));
  const elegidos = siguen.sort((a, b) => Math.abs(czAnual(C, c, b, M)) - Math.abs(czAnual(C, c, a, M))).slice(0, c.k).concat(nuevos).slice(0, c.k);
  const pos = {};
  for (const m of elegidos) pos[m] = lado(m) / c.k; // cubierto: fracción del dinero en la pareja; sin cubrir: posición con signo
  return pos;
}
const czPesos = (C) => {
  const ids = CZ_CAZADORES.map((c) => c.id), s = ids.reduce((a, id) => a + Math.exp(C.eq.lw[id] || 0), 0), w = {};
  for (const id of ids) w[id] = Math.exp(C.eq.lw[id] || 0) / s;
  return w;
};
// Una hora en vivo. M = czMercados(...) de esta hora.
function czPaso(C, M, t) {
  const horas = C.t == null ? 1 : Math.max(1, Math.round((t - C.t) / H1));
  const w0 = czPesos(C), r = {};
  let rEq = 0, alguno = false;
  for (const c of CZ_CAZADORES) { // 1) cobrar o pagar la hora que acaba
    const X = C.cz[c.id];
    if (X.tUlt == null) continue;
    let x = 0;
    for (const [m, q] of Object.entries(X.pos)) {
      const f = (C.f[m] || 0) * horas, a = C.px[m], b = M[m] ? M[m].px : null;
      if (c.modo === 'cubierto') x += q * AP.PARTE_CARRY * f;
      else if (a > 0 && b > 0) x += q * (b / a - 1 - f);
    }
    x -= X.coste || 0; X.coste = 0;
    apSuma(X.st, Math.max(-0.99, x));
    r[c.id] = x; rEq += w0[c.id] * x; alguno = true;
  }
  if (alguno) apSuma(C.eq.st, Math.max(-0.99, rEq));
  for (const c of CZ_CAZADORES) if (r[c.id] != null) C.eq.lw[c.id] = (C.eq.lw[c.id] || 0) + CZ.ETA * Math.log(1 + Math.max(r[c.id], -0.99)); // 2) el equipo aprende
  const w1 = czPesos(C), N = CZ_CAZADORES.length;
  for (const c of CZ_CAZADORES) C.eq.lw[c.id] = Math.log((1 - CZ.REPARTO) * w1[c.id] + CZ.REPARTO / N);
  const mx = Math.max(...CZ_CAZADORES.map((c) => C.eq.lw[c.id]));
  for (const c of CZ_CAZADORES) C.eq.lw[c.id] -= mx;
  for (const [m, d] of Object.entries(M)) { // 3) memoria del funding de cada mercado
    const h = C.n[m] ? horas : 1;
    C.e24[m] = C.e24[m] == null ? d.f : C.e24[m] + (1 - Math.pow(1 - CZ.E24, h)) * (d.f - C.e24[m]);
    C.n[m] = (C.n[m] || 0) + 1;
  }
  for (const m of Object.keys(C.e24)) if (!M[m]) { delete C.e24[m]; delete C.n[m]; } // mercados que desaparecen
  const usados = new Set();
  for (const c of CZ_CAZADORES) { // 4) cada cazador elige
    const X = C.cz[c.id];
    const pos = czElige(C, c, M, X.pos);
    const giro = apGiro(pos, X.pos);
    X.coste = c.modo === 'cubierto' ? apCosteCarry(giro) : giro * AP.COMISION;
    X.pos = pos; X.tUlt = t;
    for (const m of Object.keys(pos)) usados.add(m);
  }
  C.px = {}; C.f = {};
  for (const m of usados) { C.px[m] = M[m].px; C.f[m] = M[m].f; }
  C.t = t;
  return { cazadores: CZ_CAZADORES.length, mercados: Object.keys(M).length, conPosicion: usados.size };
}
async function czCargar(env) {
  const fila = await env.DB.prepare('SELECT json FROM ap_estado WHERE id = ?1').bind('cazadores').first();
  return fila ? JSON.parse(fila.json) : null;
}
async function czGuardar(env, C) {
  await env.DB.prepare('INSERT INTO ap_estado (id, json, t) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET json = excluded.json, t = excluded.t').bind('cazadores', JSON.stringify(C), C.t || Date.now()).run();
}
const CZ_NOTA = 'Cazadores de funding, en papel: 8 reglas que buscan cada hora, entre los perpetuos de Hyperliquid con más de 1 M$ de volumen al día, a quienes pagan demasiado por estar apalancados. Cubiertos: venden el perpetuo y compran lo mismo al contado, sin riesgo de precio, y cobran el funding (dos tercios del dinero lo cobran; coste de entrar y salir como el cobro del funding del sistema); supone que hay contado para cubrirse, y en monedas pequeñas no siempre lo hay. Sin cubrir: apuestan contra el exceso y sí dependen del precio. Trabajan en equipo: el resultado del equipo pondera a cada cazador por lo que gana. tStat por encima de 2: poco probable que sea suerte. No mueve dinero ni es una recomendación.';
async function czVista(env, v) {
  await apTablas(env);
  const C = await czCargar(env);
  if (!C) return { rows: [], nota: 'Los cazadores empiezan en la próxima hora en vivo.' };
  if (v === 'cazadores_mercado') {
    const quien = {};
    for (const c of CZ_CAZADORES) for (const m of Object.keys(C.cz[c.id].pos)) quien[m] = (quien[m] || 0) + 1;
    const rows = Object.keys(C.e24).filter((m) => C.n[m] >= 3).map((m) => ({ mercado: m, media24hAnualPct: C.e24[m] * 8760 * 100, cazadores: quien[m] || 0 }))
      .sort((a, b) => Math.abs(b.media24hAnualPct) - Math.abs(a.media24hAnualPct) || (a.mercado < b.mercado ? -1 : 1)).slice(0, CZ.MAX_MERCADO);
    return { rows, hora: C.t ? iso(C.t) : null, nota: 'Los perpetuos que más funding pagan o cobran, por su media de unas 24 h, en % al año (todos los mercados, también los de poco volumen, que los cazadores no tocan). Positivo: los compradores pagan a los vendedores. cazadores: cuántos de los 8 están dentro. ' + CZ_NOTA };
  }
  const w = czPesos(C), mq = apMomentos(C.eq.st);
  const rows = CZ_CAZADORES.map((c) => {
    const X = C.cz[c.id], m = apMomentos(X.st);
    return { id: c.id, cazador: c.nombre, modo: c.modo === 'cubierto' ? 'cubierto' : 'sin cubrir', horas: m.n, rentPct: (Math.exp(X.st.log) - 1) * 100, tStat: m.sr * Math.sqrt(m.n), caidaMaxPct: X.st.dd * 100,
      pesoEquipoPct: w[c.id] * 100, mercados: Object.keys(X.pos).join(', ') || 'ninguno', exposicionPct: Object.values(X.pos).reduce((a, b) => a + Math.abs(b), 0) * 100 };
  }).sort((a, b) => b.rentPct - a.rentPct);
  return { rows, equipo: { horas: mq.n, rentPct: (Math.exp(C.eq.st.log) - 1) * 100, tStat: mq.sr * Math.sqrt(mq.n), caidaMaxPct: C.eq.st.dd * 100, desde: iso(C.creado) }, hora: C.t ? iso(C.t) : null, nota: CZ_NOTA };
}

async function aprendizaje({ vista } = {}, env) {
  const vs = vista || 'resumen';
  if (vs === 'semana' || vs === 'semana_resumen' || vs === 'semana_fuerza') {
    const S = await semanaLeer();
    if (S.error) return { rows: [], nota: S.error };
    const rows = vs === 'semana' ? S.mercados : vs === 'semana_resumen' ? S.resumen : S.fuerza;
    return { rows, generado: S.generado, nota: SEMANA_NOTA };
  }
  if (!env || !env.DB) throw new Error('Falta conectar la base de datos D1 (variable DB) al Worker.');
  const v = vista || 'resumen';
  if (v === 'avisos' || v === 'avisos_prueba') return avisosVista(env, v === 'avisos_prueba');
  if (v === 'practicas' || v === 'practicas_lecciones' || v === 'practicas_retirados') return prVista(env, v);
  if (v === 'cazadores' || v === 'cazadores_mercado') return czVista(env, v);
  const E = await apCargar(env);
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
    const rows = AP.MERCADOS.map((m) => { const x = (E.posSistema || {})[m] || 0; const s = (E.senal || {})[m] || 0; return { moneda: apEtiqueta(m), posicionPct: x * 100, senal: s > 0 ? 'comprar' : s < 0 ? 'vender' : 'nada', precio: E.monedas[m] ? E.monedas[m].px : null }; });
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
    const seg = new Set(apSeguidas(E, Date.now()));
    const tipos = new Map(((E.traders && E.traders.lista) || []).map((x) => [x.d, x.tipo]));
    const rows = Object.entries(E.carteras).filter(([addr]) => seg.has(addr)).map(([addr, W]) => ({
      cartera: addr.slice(0, 6) + '…' + addr.slice(-4), direccion: addr, tipo: tipos.get(addr) || 'cuenta', horas: W.st.n, rentPct: pct(W.st.log),
      t: hab[addr] ? hab[addr].t : 0, tVivo: hab[addr] ? hab[addr].tVivo : 0, previa: hab[addr] ? hab[addr].previa : 0,
      habilidadPct: hab[addr] ? hab[addr].habilidad * 100 : 0, posiciones: Object.keys(W.pos || {}).length,
    }));
    rows.sort((a, b) => b.habilidadPct - a.habilidadPct || b.t - a.t);
    const T = E.traders;
    const origen = T && seg.size && T.lista.some((x) => seg.has(x.d))
      ? 'Elegidas por el laboratorio el ' + String(T.gen).slice(0, 10) + ' por su historial completo (puntuación t de sus rentabilidades quincenales del último año). ' + (T.previa ? 'Previa: esa puntuación encogida a la mitad, que cuenta como ' + TRADERS_HORAS_PREVIA + ' horas en vivo.' : 'Sin previa: el historial no predijo lo bastante en la prueba del laboratorio.')
      : 'Lista fija del ranking de Hyperliquid (24-nov-2026), hasta que llegue la selección del laboratorio.';
    return { rows, seleccion: T ? { generado: T.gen, previa: T.previa, carteras: T.lista.length } : null, nota: origen + ' Rentabilidad estimada hora a hora desde que se siguen (solo por el precio de sus posiciones, sin funding ni operaciones dentro de la hora). Habilidad: indicador de 0 a 100 basado en la prueba t combinada (historial y vivo). No es la probabilidad de que no sea suerte. Sin previa hacen falta al menos 24 horas.' };
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
      mejorExperto: mejor ? mejor.nombre : null, pesoMejorPct: mejor ? mejor.pesoPct : null, carterasSeguidas: E.seguidas || CARTERAS_SEGUIDAS.length, seleccionTraders: E.traders ? { generado: E.traders.gen, previa: E.traders.previa, carteras: E.traders.lista.length } : null,
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
  { name: 'aprendizaje', title: 'Sistema que aprende', description: 'Estado del sistema que aprende cada hora (en papel): resumen, expertos y sus pesos, posiciones combinadas, curva diaria frente a Bitcoin, carteras seguidas con su habilidad, avisos, lo que propone el laboratorio y el bot de pruebas (50, 200 y 1000 € en papel en Kraken Futuros).', inputSchema: { type: 'object', properties: { vista: { type: 'string', enum: ['resumen', 'expertos', 'posiciones', 'curva', 'carteras', 'alertas', 'laboratorio', 'bot', 'ml', 'semana', 'semana_resumen', 'semana_fuerza', 'avisos', 'avisos_prueba', 'practicas', 'practicas_lecciones', 'practicas_retirados', 'cazadores', 'cazadores_mercado'], description: 'Qué parte ver. Por defecto, resumen. bot: carteras en papel de 50, 200 y 1000 € que siguen al sistema en Kraken Futuros con costes y mínimos reales. ml: la señal diaria del aprendizaje automático y cómo le va a su experto. semana: unos 25 mercados ordenados por su tendencia de 12 semanas, con su historial; semana_resumen: cómo le fue a comprar cada semana las 3 mejores; semana_fuerza: la semana siguiente según la fuerza de la señal. avisos: el canal de ntfy para recibir avisos en el móvil y los últimos enviados; avisos_prueba: manda un aviso de prueba (uno cada 10 minutos como mucho). practicas: la zona de prácticas (alumnos que prueban variantes de las estrategias con riesgo ×1, ×2 o ×3, en papel); practicas_lecciones: qué decisiones funcionan mejor; practicas_retirados: los que se retiraron o quebraron y por qué. cazadores: los 8 cazadores de funding (cubiertos y sin cubrir) y su equipo; cazadores_mercado: los mercados que más funding pagan ahora.' } }, additionalProperties: false }, fn: aprendizaje },
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
        // avisos al móvil: ranking semanal y, los lunes a las 9:47 de Madrid, el plan de Bitcoin (+1 petición con caché, +1 a Bitstamp, +2 a ntfy como mucho)
        if (minuto === AVISO.MINUTO) await avisosHora(env).catch((e) => console.log('avisos: ' + (e.message || e)));
        if (minuto === 37) await apLabMinuto(env).catch((e) => console.log('laboratorio: ' + (e.message || e)));
        // bot de pruebas: del minuto :07 al :12 hasta que haga la hora (+2 peticiones); fichas de Kraken a las :27 (+1, una vez al día)
        if (minuto >= BOT.MINUTO && minuto < BOT.MINUTO + 6) await botHora(env).catch((e) => console.log('bot: ' + (e.message || e)));
        if (minuto === BOT.MINUTO_FICHAS) await botFichas(env).catch((e) => console.log('fichas Kraken: ' + (e.message || e)));
      }
    })());
  },
};
