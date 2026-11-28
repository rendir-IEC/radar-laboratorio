// Pruebas de los cazadores de funding (v2.9.0, con las reglas de la v2.9.1): 8 cazadores (cubiertos y sin cubrir), su aprendizaje
// en equipo y sus vistas. Desde la v2.9.1 los cubiertos deciden con la media del funding (24 h; el constante, 3 días), quien está
// dentro aguanta hasta la mitad del volumen mínimo, y el estado v1 se migra (los cubiertos empiezan de cero).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let fallos = 0;
const check = (ok, msg) => { console.log((ok ? 'OK    ' : 'FALLO ') + msg); if (!ok) fallos++; };
const fuente = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8') +
  '\nexport { aprendizaje, czNuevo, czMigra, czMercados, czPaso, czPesos, CZ, CZ_CAZADORES, AP, H1, VERSION };\n';
const tmp = path.join(os.tmpdir(), 'worker_v29_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);
const { H1, AP } = W;
const anual = (x) => x / 8760; // de % anual (en tanto por uno) a tasa horaria

// mercado sintético: nombre → [precio, funding anual, volumen 24 h]
const hora = (filas) => {
  const nombres = Object.keys(filas);
  return W.czMercados({ universe: nombres.map((n) => ({ name: n, isDelisted: n === 'MUERTA' })) }, nombres.map((n) => ({ markPx: String(filas[n][0]), funding: String(anual(filas[n][1])), dayNtlVlm: String(filas[n][2]) })));
};
const base = { A: [10, 1.5, 3e6], B: [20, 0.6, 2e6], C: [5, 0.25, 8e6], D: [8, -0.8, 2e6], E: [1, 0, 9e6], F: [3, 3.0, 1e5], MUERTA: [1, 5, 9e9] };

check(/^2\.(9\.[1-9]|[1-9]\d\.)/.test(W.VERSION) || /^[3-9]\./.test(W.VERSION), 'versión ' + W.VERSION);
check(W.CZ_CAZADORES.length === 8 && new Set(W.CZ_CAZADORES.map((c) => c.id)).size === 8, 'un equipo de 8 cazadores');
check(W.CZ_CAZADORES.filter((c) => c.modo === 'cubierto').every((c) => c.media === 24 || c.media === 72), 'los 5 cubiertos deciden con la media del funding');
check(W.CZ_CAZADORES.filter((c) => c.modo !== 'cubierto').every((c) => !c.media), 'los 3 sin cubrir siguen con el pago de ahora');
const M0 = hora(base);
check(!M0.MUERTA && Object.keys(M0).length === 6, 'los mercados retirados no cuentan');

const T0 = Date.UTC(2026, 10, 26, 22);
const C = W.czNuevo(T0);
let t = T0;
W.czPaso(C, M0, t);
const pos = (id) => C.cz[id].pos;
const ks = (id) => Object.keys(pos(id)).sort().join(',');
check(['cz_cob_20', 'cz_cob_50', 'cz_cob_100', 'cz_cob_liq', 'cz_cob_const'].every((id) => ks(id) === ''), 'primera hora: los cubiertos esperan a tener 12 horas de media');
check(ks('cz_contra_compra') === 'A' && pos('cz_contra_compra').A < 0, 'sin cubrir: vende A, donde los compradores pagan 150 %');
check(ks('cz_contra_venta') === 'D' && pos('cz_contra_venta').D > 0, 'sin cubrir: compra D, donde los vendedores pagan 80 %');
check(ks('cz_contra_ambos') === 'A,D', 'contra los dos lados: vende A y compra D');
for (let i = 0; i < 10; i++) W.czPaso(C, hora(base), (t += H1));
check(ks('cz_cob_20') === '', 'con 11 horas, aún nada');
W.czPaso(C, hora(base), (t += H1));
check(ks('cz_cob_20') === 'A,B,C' && Math.abs(pos('cz_cob_20').A - 0.2) < 1e-12, 'con 12 horas: el de 20 % entra en A, B y C, un quinto del dinero cada una (' + ks('cz_cob_20') + ')');
check(ks('cz_cob_50') === 'A,B' && ks('cz_cob_100') === 'A', 'desde 50 %: A y B; solo extremos: A');
check(ks('cz_cob_liq') === 'C', 'entre las muy líquidas (más de 5 M$) solo C paga más del 10 %');
check(ks('cz_cob_const') === '', 'el de pago constante espera a tener 36 horas (media de 3 días)');
check(!Object.values(C.cz).some((X) => X.pos.F), 'F paga 300 % pero no tiene volumen: nadie entra');

// una hora con precios quietos: los cubiertos cobran el funding menos el coste de entrar
const antes20 = C.cz.cz_cob_20.st.log;
W.czPaso(C, hora(base), (t += H1));
const r20 = Math.exp(C.cz.cz_cob_20.st.log - antes20) - 1;
const esperado = 0.2 * AP.PARTE_CARRY * (anual(1.5) + anual(0.6) + anual(0.25)) - 0.6 * AP.PARTE_CARRY * AP.COSTE_CARRY / 2;
check(Math.abs(r20 - esperado) < 1e-12, 'cuentas del cubierto: funding cobrado menos el coste de entrar (' + (r20 * 100).toFixed(4) + ' %)');
// A cae un 2 %: gana el que la vendió sin cubrir; el cubierto no lo nota
const caida = { ...base, A: [9.8, 1.5, 3e6] };
const antesC = C.cz.cz_contra_compra.st.log, antes20b = C.cz.cz_cob_20.st.log;
W.czPaso(C, hora(caida), (t += H1));
const rc = Math.exp(C.cz.cz_contra_compra.st.log - antesC) - 1;
check(Math.abs(rc - (1 / 3) * (0.02 + anual(1.5))) < 1e-12, 'sin cubrir: vende A y A cae un 2 %: gana un tercio de 2 % más el funding (' + (rc * 100).toFixed(4) + ' %)');
check(Math.abs(Math.exp(C.cz.cz_cob_20.st.log - antes20b) - 1 - 0.2 * AP.PARTE_CARRY * (anual(1.5) + anual(0.6) + anual(0.25))) < 1e-12, 'el cubierto no nota la caída del precio');

// el pago de una hora salta: los cubiertos no se mueven por un mal dato
const giros = () => Object.values(C.cz).map((X) => X.coste);
W.czPaso(C, hora({ ...caida, B: [20, 0.05, 2e6] }), (t += H1));
check(pos('cz_cob_50').B && pos('cz_cob_20').B, 'B paga una hora solo el 5 %: los cubiertos siguen dentro (la media apenas baja)');
check(C.cz.cz_cob_50.coste === 0 && C.cz.cz_cob_20.coste === 0, 'y no pagan coste de salir y volver a entrar');
// si el pago bajo se mantiene, la media baja y salen cuando toca: el de 50 % por debajo del 20 %, el de 20 % por debajo del 10 %
let h50 = 0;
while (pos('cz_cob_50').B && h50 < 100) { W.czPaso(C, hora({ ...caida, B: [20, 0.15, 2e6] }), (t += H1)); h50++; }
check(!pos('cz_cob_50').B && pos('cz_cob_20').B && h50 > 20 && h50 < 30, 'B se queda en 15 %: el de 50 % sale tras ' + h50 + ' horas; el de 20 % la mantiene');
// histéresis en el volumen: C (8 M$) en el de muy líquidas (mínimo 5 M$) aguanta hasta la mitad
W.czPaso(C, hora({ ...caida, B: [20, 0.15, 2e6], C: [5, 0.25, 3e6] }), (t += H1));
check(pos('cz_cob_liq').C, 'C baja a 3 M$ de volumen: el de muy líquidas la mantiene (aguanta hasta 2,5 M$)');
W.czPaso(C, hora({ ...caida, B: [20, 0.15, 2e6], C: [5, 0.25, 2e6] }), (t += H1));
check(!pos('cz_cob_liq').C, 'C baja a 2 M$: sale');
W.czPaso(C, hora({ ...caida, B: [20, 0.15, 2e6], C: [5, 0.25, 3e6] }), (t += H1));
check(!pos('cz_cob_liq').C, 'vuelve a 3 M$: no entra (para entrar hacen falta 5 M$)');
// el de pago constante entra cuando la media de 3 días lo confirma
check(C.n.A >= 36 && pos('cz_cob_const').A && !pos('cz_cob_const').C, 'con ' + C.n.A + ' horas, el de pago constante está en A (media de 3 días ≥ 30 %): ' + ks('cz_cob_const'));

// el equipo aprende: con A cayendo sin parar, el que la vende gana peso
let pa = 9.8;
for (let i = 0; i < 48; i++) { pa *= 0.995; W.czPaso(C, hora({ ...base, A: [pa, 1.5, 3e6] }), (t += H1)); }
const w = W.czPesos(C);
const suma = Object.values(w).reduce((a, b) => a + b, 0);
check(Math.abs(suma - 1) < 1e-9 && w.cz_contra_compra > 1.5 / 8 && w.cz_contra_compra === Math.max(...Object.values(w)), 'el equipo escucha más al que acierta: «vende cuando los compradores pagan demasiado» pesa ' + (w.cz_contra_compra * 100).toFixed(1) + ' %');
check(C.eq.st.n === C.cz.cz_cob_20.st.n && Math.exp(C.eq.st.log) > 1, 'el equipo cobra cada hora: ' + ((Math.exp(C.eq.st.log) - 1) * 100).toFixed(2) + ' % en ' + C.eq.st.n + ' h');
check(Object.keys(C.px).every((m) => Object.values(C.cz).some((X) => X.pos[m])), 'solo guarda precios de lo que tiene alguien (' + Object.keys(C.px).length + ' mercados)');
check(JSON.stringify(C).length < 20000, 'estado pequeño: ' + JSON.stringify(C).length + ' bytes');

// mercado que desaparece: no rompe nada y deja de contar
W.czPaso(C, hora({ B: [20, 0.6, 2e6], C: [5, 0.25, 8e6] }), (t += H1));
check(!pos('cz_contra_compra').A && !C.e24.A && !C.e72.A, 'si un mercado desaparece, se sale y se olvida');

// migración del estado de la v2.9.0 (v1): los cubiertos empiezan de cero, los sin cubrir siguen; la media de 3 días sale de la de 24 h
const V = W.czNuevo(T0);
let tv = T0;
for (let i = 0; i < 14; i++) W.czPaso(V, hora(base), (tv += H1));
V.v = 1; delete V.e72; delete V.cambios;
const nContra = V.cz.cz_contra_compra.st.n, logContra = V.cz.cz_contra_compra.st.log, posCob = { ...V.cz.cz_cob_20.pos };
W.czMigra(V, tv);
check(V.v === 2 && V.cz.cz_cob_20.st.n === 0 && V.cz.cz_cob_const.st.n === 0, 'migración: los cubiertos empiezan su cuenta de cero');
check(V.cz.cz_contra_compra.st.n === nContra && V.cz.cz_contra_compra.st.log === logContra, 'migración: los sin cubrir conservan su historia (' + nContra + ' h)');
check(JSON.stringify(V.cz.cz_cob_20.pos) === JSON.stringify(posCob), 'migración: nadie cierra posiciones por el cambio');
check(Object.keys(V.e72).length === Object.keys(V.e24).length && V.e72.A === V.e24.A, 'migración: la media de 3 días arranca desde la de 24 h');
check(V.cambios.length === 1 && /2\.9\.1/.test(V.cambios[0].nota), 'migración: queda apuntado el cambio de reglas');
check(W.czMigra(V, tv + H1) === V && V.cambios.length === 1, 'migrar dos veces no hace nada');
W.czPaso(V, hora(base), (tv += H1));
check(V.cz.cz_cob_20.st.n === 1 && Object.keys(V.cz.cz_cob_20.pos).length === 3, 'tras migrar, la primera hora cuenta con las posiciones que había');

// vistas
const db = new DatabaseSync(':memory:');
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => { db.prepare(sql).run(...args); return { success: true }; }, _run: () => db.prepare(sql).run(...args) });
const ENV = { DB: { prepare: (sql) => stmt(sql), batch: async (ops) => { for (const o of ops) o._run(); return []; } } };
let v = await W.aprendizaje({ vista: 'cazadores' }, ENV);
check(v.rows.length === 0 && /próxima hora/.test(v.nota), 'antes de empezar, la vista lo explica');
db.prepare("INSERT INTO ap_estado (id, json, t) VALUES ('cazadores', ?, ?)").run(JSON.stringify(V), V.t);
v = await W.aprendizaje({ vista: 'cazadores' }, ENV);
check(v.rows.length === 8 && v.rows.every((x) => typeof x.cazador === 'string' && Number.isFinite(x.rentPct) && Number.isFinite(x.pesoEquipoPct) && ['cubierto', 'sin cubrir'].includes(x.modo)) && Math.abs(v.rows.reduce((a, x) => a + x.pesoEquipoPct, 0) - 100) < 1e-6, 'vista cazadores: ' + v.rows[0].cazador + ' ' + v.rows[0].rentPct.toFixed(2) + ' %');
check(v.equipo && Number.isFinite(v.equipo.rentPct) && v.equipo.horas > 0, 'vista: el equipo va ' + v.equipo.rentPct.toFixed(2) + ' %');
check(Array.isArray(v.cambios) && v.cambios.length === 1 && /T/.test(v.cambios[0].fecha), 'vista: enseña el cambio de reglas del ' + v.cambios[0].fecha);
check(/media del funding de 24 h/.test(v.nota), 'la nota explica las reglas nuevas');
db.prepare("UPDATE ap_estado SET json = ? WHERE id = 'cazadores'").run(JSON.stringify(C));
const vm = await W.aprendizaje({ vista: 'cazadores_mercado' }, ENV);
check(vm.rows.length > 0 && vm.rows.every((x) => Number.isFinite(x.media24hAnualPct)) && (vm.rows[0].mercado === 'D' || vm.rows[0].mercado === 'B'), 'vista de mercados: ' + vm.rows.map((x) => x.mercado + ' ' + x.media24hAnualPct.toFixed(0) + ' %').join(', '));
check(!JSON.stringify([v, vm]).includes('NaN'), 'sin NaN');

console.log(fallos ? fallos + ' FALLOS' : 'todo OK');
process.exit(fallos ? 1 : 0);
