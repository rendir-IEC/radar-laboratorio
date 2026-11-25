// Núcleo del plan semanal de Bitcoin y del reto semanal: funciones puras sobre velas diarias [{fecha, o, h, l, c}]
// ya cerradas y ordenadas. Las reglas se fijaron antes de mirar resultados y no se optimizan.
const PLAN = {
  CAPITAL: 962,           // el dinero de Catalina
  SEMANAS_BASE: 12,       // compra base = capital / 12 cada lunes
  COSTE_COMPRA: 0.005,    // 0,5 % por compra (comisión y diferencial, conservador)
  INTERES_CAJA: 0.02,     // el dinero que espera cobra un 2 % al año
  MEDIA: 200,             // múltiplo de Mayer: precio / media de 200 días
  TRAMOS: [[0.8, 2], [1.0, 1.5], [1.5, 1], [2.4, 0.5], [Infinity, 0]],
};
const RETO = {
  CAPITAL: 962,
  GANAR: 100,             // objetivo de la semana, en €
  PERDER: 50,             // lo máximo que se arriesga, en €
  APALANCAMIENTO: 3,
  MEDIA: 140,             // dirección: precio por encima (al alza) o por debajo (a la baja) de su media de 20 semanas
  COSTE_SEMANA: 0.0015,   // 0,05 % al entrar y al salir + ~0,05 % de funding, sobre lo invertido
  INICIO_VIVO: '2026-11-30',
};

function planMultiplo(M) {
  for (const [hasta, x] of PLAN.TRAMOS) if (M < hasta) return x;
  return 0;
}

function _lunes(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) if (new Date(rows[i].fecha + 'T00:00:00Z').getUTCDay() === 1) out.push(i);
  return out;
}

function _media(c, fin, n) {
  if (fin - n + 1 < 0) return null;
  let s = 0;
  for (let k = fin - n + 1; k <= fin; k++) s += c[k];
  return s / n;
}

function _resumen(xs) {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const q = (p) => o[Math.min(o.length - 1, Math.max(0, Math.round(p * (o.length - 1))))];
  return { n: xs.length, mediana: q(0.5), p10: q(0.1), p90: q(0.9), peor: o[0], mejor: o[o.length - 1], conGananciaPct: (xs.filter((x) => x > 1).length / xs.length) * 100 };
}

// Simula una forma de comprar desde el lunes de índice i0: devuelve valor (en múltiplos del capital) semana a semana.
function _simular(rows, lunes, k0, forma, semanas) {
  const c = rows.map((r) => r.c);
  const b = 1 / PLAN.SEMANAS_BASE;
  const interes = Math.pow(1 + PLAN.INTERES_CAJA, 7 / 365);
  let caja = 1, btc = 0;
  const valores = [];
  for (let k = k0; k < Math.min(lunes.length, k0 + semanas + 1); k++) {
    const i = lunes[k];
    const p = c[i - 1];
    if (k - k0 < semanas) {
      let compra = 0;
      if (forma === 'todo') compra = k === k0 ? caja : 0;
      else if (forma === 'tramos') compra = k - k0 < PLAN.SEMANAS_BASE ? Math.min(caja, b) : 0;
      else {
        const m = _media(c, i - 1, PLAN.MEDIA);
        compra = m ? Math.min(caja, b * planMultiplo(p / m)) : 0;
        if (caja - compra < 1e-3) compra = caja;
      }
      if (compra > 0) { btc += (compra * (1 - PLAN.COSTE_COMPRA)) / p; caja -= compra; }
    }
    valores.push(caja + btc * p);
    caja *= interes;
  }
  return valores;
}

// Todas las fechas de entrada (cada lunes con 200 días de historia y el plazo completo por delante).
function planHistoria(rows) {
  const lunes = _lunes(rows);
  const formas = ['todo', 'tramos', 'reglas'];
  const plazos = [52, 104];
  const res = {};
  for (const f of formas) res[f] = { 52: [], 104: [], peorMomento: [] };
  let n = 0;
  for (let k = 0; k < lunes.length; k++) {
    if (lunes[k] - 1 < PLAN.MEDIA) continue;
    if (k + 104 >= lunes.length) break;
    n++;
    for (const f of formas) {
      const v = _simular(rows, lunes, k, f, 104);
      for (const h of plazos) res[f][h].push(v[h]);
      res[f].peorMomento.push(Math.min(...v));
    }
  }
  const nombre = { todo: 'Todo el primer día', tramos: 'Por tramos iguales (12 semanas)', reglas: 'Con reglas (más cuando está barato)' };
  return formas.map((f) => {
    const a1 = _resumen(res[f][52]), a2 = _resumen(res[f][104]), pm = _resumen(res[f].peorMomento);
    return {
      forma: nombre[f], entradas: n,
      desde: n ? rows[lunes.find((i) => i - 1 >= PLAN.MEDIA)].fecha : null,
      ganaA1AnoPct: a1 && a1.conGananciaPct, medianaA1Ano: a1 && a1.mediana, peorA1Ano: a1 && a1.peor,
      ganaA2AnosPct: a2 && a2.conGananciaPct, medianaA2Anos: a2 && a2.mediana, peorA2Anos: a2 && a2.peor, mejorA2Anos: a2 && a2.mejor,
      peorMomentoMediana: pm && pm.mediana, peorMomento: pm && pm.peor,
    };
  });
}

// Lo que dice el plan esta semana (con el último cierre).
function planHoy(rows) {
  const c = rows.map((r) => r.c);
  const n = c.length;
  const m = _media(c, n - 1, PLAN.MEDIA);
  if (!m) return null;
  const M = c[n - 1] / m;
  const x = planMultiplo(M);
  const base = PLAN.CAPITAL / PLAN.SEMANAS_BASE;
  return { fecha: rows[n - 1].fecha, precio: c[n - 1], media200: m, multiploMayer: M, distanciaMediaPct: (M - 1) * 100, veces: x, baseEur: base, compraEur: Math.min(PLAN.CAPITAL, base * x) };
}

// Una semana del reto desde el lunes de índice i (decide con el cierre del domingo).
function _semanaReto(rows, i, dirFija) {
  const c = rows.map((r) => r.c);
  const m = _media(c, i - 1, RETO.MEDIA);
  if (!m || i + 6 >= rows.length) return null;
  const dir = dirFija || (c[i - 1] > m ? 1 : -1);
  const entrada = c[i - 1];
  const N = RETO.CAPITAL * RETO.APALANCAMIENTO;
  const coste = N * RETO.COSTE_SEMANA;
  const subeObj = (RETO.GANAR + coste) / N, bajaStop = (RETO.PERDER - coste) / N;
  let resultado = null, cierre = 'domingo', dia = 7;
  for (let d = i; d <= i + 6; d++) {
    const r = rows[d];
    const tocaStop = dir > 0 ? r.l <= entrada * (1 - bajaStop) : r.h >= entrada * (1 + bajaStop);
    const tocaObj = dir > 0 ? r.h >= entrada * (1 + subeObj) : r.l <= entrada * (1 - subeObj);
    if (tocaStop) { resultado = -RETO.PERDER; cierre = 'stop'; dia = d - i + 1; break; } // si toca los dos el mismo día, se cuenta el stop
    if (tocaObj) { resultado = RETO.GANAR; cierre = 'objetivo'; dia = d - i + 1; break; }
  }
  if (resultado == null) resultado = dir * N * (c[i + 6] / entrada - 1) - coste;
  return { semana: rows[i].fecha, direccion: dir > 0 ? 'al alza' : 'a la baja', entrada, resultadoEur: resultado, cierre, dia };
}

function _estadisticas(sem) {
  if (!sem.length) return null;
  let racha = 0, peorRacha = 0, acum = 0, pico = 0, caida = 0;
  for (const s of sem) {
    racha = s.resultadoEur < 0 ? racha + 1 : 0;
    peorRacha = Math.max(peorRacha, racha);
    acum += s.resultadoEur; pico = Math.max(pico, acum); caida = Math.min(caida, acum - pico);
  }
  const n = sem.length;
  return {
    semanas: n, objetivoPct: (sem.filter((s) => s.cierre === 'objetivo').length / n) * 100, stopPct: (sem.filter((s) => s.cierre === 'stop').length / n) * 100,
    ganadorasPct: (sem.filter((s) => s.resultadoEur > 0).length / n) * 100, totalEur: acum, mediaSemanaEur: acum / n, peorRachaSemanas: peorRacha, peorCaidaEur: caida,
  };
}

// Todas las semanas desde que hay 20 semanas de historia: con la regla y, para comparar, siempre al alza.
function retoHistoria(rows) {
  const lunes = _lunes(rows);
  const conRegla = [], siempreAlza = [];
  for (const i of lunes) {
    if (i - 1 < RETO.MEDIA) continue;
    const s = _semanaReto(rows, i), a = _semanaReto(rows, i, 1);
    if (s) conRegla.push(s);
    if (a) siempreAlza.push(a);
  }
  const ult = (xs) => xs.slice(-104);
  const vivo = conRegla.filter((s) => s.semana >= RETO.INICIO_VIVO);
  return {
    semanas: conRegla,
    filas: [
      { que: 'Con la regla, desde ' + (conRegla[0] ? conRegla[0].semana.slice(0, 4) : '—'), ...(_estadisticas(conRegla) || {}) },
      { que: 'Con la regla, últimos 2 años', ...(_estadisticas(ult(conRegla)) || {}) },
      { que: 'Siempre al alza, desde ' + (siempreAlza[0] ? siempreAlza[0].semana.slice(0, 4) : '—'), ...(_estadisticas(siempreAlza) || {}) },
      { que: 'Con la regla, en vivo (desde el 30-nov-2026)', ...(_estadisticas(vivo) || { semanas: 0 }) },
    ],
  };
}

// La apuesta de esta semana: dirección con el último cierre, niveles de objetivo y stop.
function retoHoy(rows) {
  const c = rows.map((r) => r.c);
  const n = c.length;
  const m = _media(c, n - 1, RETO.MEDIA);
  if (!m) return null;
  const dir = c[n - 1] > m ? 1 : -1;
  const N = RETO.CAPITAL * RETO.APALANCAMIENTO;
  const coste = N * RETO.COSTE_SEMANA;
  const subeObj = (RETO.GANAR + coste) / N, bajaStop = (RETO.PERDER - coste) / N;
  const p = c[n - 1];
  return {
    fecha: rows[n - 1].fecha, direccion: dir > 0 ? 'al alza' : 'a la baja', precio: p, media140: m, distanciaMediaPct: (p / m - 1) * 100,
    nocionalEur: N, apalancamiento: RETO.APALANCAMIENTO, ganarEur: RETO.GANAR, perderEur: RETO.PERDER,
    precioObjetivo: dir > 0 ? p * (1 + subeObj) : p * (1 - subeObj), precioStop: dir > 0 ? p * (1 - bajaStop) : p * (1 + bajaStop),
    movimientoObjetivoPct: subeObj * 100, movimientoStopPct: bajaStop * 100, costeEur: coste,
  };
}
