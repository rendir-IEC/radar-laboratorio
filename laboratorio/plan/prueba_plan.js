const fs = require('fs');
eval(fs.readFileSync(require('path').join(__dirname, 'plan_core.js'), 'utf8') + '\nglobalThis.API={planHistoria,planHoy,retoHistoria,retoHoy,planMultiplo,PLAN,RETO};');
const A = globalThis.API;
// paseo aleatorio diario sin tendencia, vol 3 %/día, desde 2016
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
const rows = []; let p = 400;
for (let t = Date.UTC(2016, 0, 1); t < Date.UTC(2026, 10, 25); t += 864e5) {
  const o = p; const intr = [o];
  for (let k = 0; k < 48; k++) intr.push(intr[intr.length - 1] * Math.exp((0.03 / Math.sqrt(48)) * gauss()));
  p = intr[intr.length - 1];
  rows.push({ fecha: new Date(t).toISOString().slice(0, 10), o, h: Math.max(...intr), l: Math.min(...intr), c: p });
}
console.assert(A.planMultiplo(0.7) === 2 && A.planMultiplo(0.9) === 1.5 && A.planMultiplo(1.2) === 1 && A.planMultiplo(2) === 0.5 && A.planMultiplo(3) === 0, 'tramos');
const ph = A.planHistoria(rows); console.log(JSON.stringify(ph.map(r => [r.forma, r.entradas, r.ganaA2AnosPct.toFixed(0), r.medianaA2Anos.toFixed(2), r.peorMomento.toFixed(2)])));
console.log(JSON.stringify(A.planHoy(rows)));
const rh = A.retoHistoria(rows); console.log(JSON.stringify(rh.filas.map(f => [f.que, f.semanas, f.objetivoPct && f.objetivoPct.toFixed(0), f.stopPct && f.stopPct.toFixed(0), f.mediaSemanaEur && f.mediaSemanaEur.toFixed(2)])));
console.log(JSON.stringify(A.retoHoy(rows)));
// controles: en un mundo sin tendencia el objetivo (+100) se toca ~1/3 de las semanas y de media se pierde el coste
// serie espejo (1/precio): sube lo que la otra baja; la media de las dos quita la tendencia de esta muestra
const espejo = rows.map((r) => ({ fecha: r.fecha, o: 1e6 / r.o, h: 1e6 / r.l, l: 1e6 / r.h, c: 1e6 / r.c }));
const a = rh.filas[2], b = A.retoHistoria(espejo).filas[2];
const obj = (a.objetivoPct + b.objetivoPct) / 2, media = (a.mediaSemanaEur + b.mediaSemanaEur) / 2;
console.log('control sin tendencia: objetivo', obj.toFixed(1), '% media', media.toFixed(2), '€/semana');
if (!(obj > 27 && obj < 36 && media < 3)) { console.log('FALLO control sin tendencia'); process.exit(1); }
// la regla en la serie espejo es la misma regla: dirección contraria cada semana
const re = A.retoHistoria(espejo).semanas, ro = rh.semanas;
const opuestas = re.filter((s, i) => s.direccion !== ro[i].direccion).length / re.length;
if (!(re.length === ro.length && opuestas > 0.95)) { console.log('FALLO espejo', opuestas); process.exit(1); }
// todo-el-primer-día: el valor a 2 años es exactamente precio2/precio0 × (1-coste)
console.log('OK');
