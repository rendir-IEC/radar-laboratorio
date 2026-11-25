// Prueba con datos reales: velas diarias de BTC/USD de Bitstamp desde 2015 (API pública). Solo publica resultados, no los datos.
import fs from 'node:fs';
const nucleo = fs.readFileSync(new URL('./plan_core.js', import.meta.url), 'utf8');
const A = new Function(nucleo + '\nreturn { planHistoria, planHoy, retoHistoria, retoHoy, PLAN, RETO };')();
const filas = [];
let desde = Math.floor(Date.UTC(2015, 0, 1) / 1000);
const hoy = new Date().toISOString().slice(0, 10);
for (let pag = 0; pag < 10; pag++) {
  const r = await fetch(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${desde}`, { headers: { 'User-Agent': 'radar-laboratorio/1.0' } });
  if (!r.ok) throw new Error('Bitstamp ' + r.status);
  const j = await r.json();
  const v = (j.data && j.data.ohlc) || [];
  if (!v.length) break;
  for (const x of v) filas.push({ fecha: new Date(Number(x.timestamp) * 1000).toISOString().slice(0, 10), o: +x.open, h: +x.high, l: +x.low, c: +x.close });
  const ult = Number(v[v.length - 1].timestamp);
  if (ult <= desde) break;
  desde = ult + 86400;
  if (v.length < 1000) break;
}
const porFecha = new Map(filas.map((f) => [f.fecha, f]));
const rows = [...porFecha.values()].filter((f) => f.fecha < hoy && f.c > 0).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
// huecos: días que faltan
let huecos = 0;
for (let i = 1; i < rows.length; i++) if (Date.parse(rows[i].fecha) - Date.parse(rows[i - 1].fecha) !== 864e5) huecos++;
const rh = A.retoHistoria(rows);
const res = {
  generado: new Date().toISOString(), datos: { fuente: 'Bitstamp BTC/USD diario', desde: rows[0].fecha, hasta: rows[rows.length - 1].fecha, dias: rows.length, huecos },
  reglas: { plan: A.PLAN, reto: A.RETO },
  plan: A.planHistoria(rows), planHoy: A.planHoy(rows),
  reto: rh.filas, retoHoy: A.retoHoy(rows),
  retoPorAno: Object.entries(rh.semanas.reduce((o, s) => { const y = s.semana.slice(0, 4); (o[y] = o[y] || []).push(s.resultadoEur); return o; }, {})).map(([ano, xs]) => ({ ano, semanas: xs.length, totalEur: Math.round(xs.reduce((a, b) => a + b, 0)), ganadorasPct: Math.round((xs.filter((x) => x > 0).length / xs.length) * 100) })),
  ultimas12: rh.semanas.slice(-12),
};
fs.mkdirSync(process.argv[2] || '/tmp/plan', { recursive: true });
fs.writeFileSync((process.argv[2] || '/tmp/plan') + '/plan.json', JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
