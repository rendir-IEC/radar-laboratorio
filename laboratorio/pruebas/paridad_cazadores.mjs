// Corre los cazadores del servidor (czPaso de servidor/worker.js) sobre unas horas dadas y devuelve su estado final.
// Uso: node pruebas/paridad_cazadores.mjs horas.json  → JSON por la salida estándar. Lo usa prueba_cazadores.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const raiz = new URL('../../servidor/worker.js', import.meta.url);
const fuente = fs.readFileSync(raiz, 'utf8') + '\nexport { czNuevo, czPaso, czPesos };\n';
const tmp = path.join(os.tmpdir(), 'worker_paridad_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);
const horas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const C = W.czNuevo(horas[0].t);
const pasos = [];
for (const h of horas) {
  W.czPaso(C, h.M, h.t);
  pasos.push(Object.fromEntries(Object.entries(C.cz).map(([id, X]) => [id, Object.keys(X.pos).join(',')])));
}
const out = { cz: {}, eq: C.eq.st, pesos: W.czPesos(C), pasos };
for (const [id, X] of Object.entries(C.cz)) out.cz[id] = { st: X.st, pos: X.pos };
process.stdout.write(JSON.stringify(out));
