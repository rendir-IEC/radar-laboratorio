// Ejecuta la memoria del servidor (apPaso de servidor/worker.js) sobre precios y funding dados por stdin
// y devuelve, hora a hora, las EMAs, la varianza y el funding medio de cada moneda. Si se le pasan "specs",
// devuelve también las posiciones que el servidor daría a esas estrategias del laboratorio en la última hora.
// Lo usa prueba_lab.py.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const raiz = new URL('../../servidor/worker.js', import.meta.url);
let src = readFileSync(raiz, 'utf8').replace('export default {', 'const __porDefecto = {');
src += '\nexport { apPaso, apEstadoNuevo, AP };\nexport const labPos = typeof apLabPosiciones === "function" ? apLabPosiciones : null;\n';
const dir = mkdtempSync(join(tmpdir(), 'mem-'));
const f = join(dir, 'w.mjs');
writeFileSync(f, src);
const { apPaso, apEstadoNuevo, AP, labPos } = await import(pathToFileURL(f).href);
const ent = JSON.parse(readFileSync(0, 'utf8'));
const E = apEstadoNuevo();
E._silencio = true;
const out = [];
for (let k = 0; k < ent.t.length; k++) {
  const px = {}, fr = {};
  for (const [m, serie] of Object.entries(ent.P)) { if (serie[k] != null) px[m] = serie[k]; }
  for (const [m, serie] of Object.entries(ent.F)) { if (serie[k] != null) fr[m] = serie[k]; }
  apPaso(E, { t: ent.t[k], px, f: fr, historia: true });
  const fila = {};
  for (const m of Object.keys(ent.P)) { const c = E.monedas[m]; if (c) fila[m] = { ema: AP.SPANS.map((s) => c.ema[s]), v2: c.v2, fe24: c.fe24, fe168: c.fe168, n: c.n }; }
  out.push(fila);
}
let posiciones = null;
if (ent.specs && labPos) {
  const ult = ent.t.length - 1;
  const listas = AP.MONEDAS.filter((m) => E.monedas[m] && E.monedas[m].n >= AP.HORAS_MIN && ent.P[m] && ent.P[m][ult] > 0);
  posiciones = ent.specs.map((sp) => labPos(E, { id: 'x', spec: sp }, listas, ent.t[ult]));
}
process.stdout.write(JSON.stringify(ent.specs ? { memoria: out, posiciones } : out));
