// Ejecuta la memoria del servidor (apPaso de servidor/worker.js) sobre precios y funding dados por stdin
// y devuelve, hora a hora, las EMAs, la varianza y el funding medio de cada moneda. Lo usa prueba_lab.py.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const raiz = new URL('../../servidor/worker.js', import.meta.url);
let src = readFileSync(raiz, 'utf8').replace('export default {', 'const __porDefecto = {');
src += '\nexport { apPaso, apEstadoNuevo, AP };\n';
const dir = mkdtempSync(join(tmpdir(), 'mem-'));
const f = join(dir, 'w.mjs');
writeFileSync(f, src);
const { apPaso, apEstadoNuevo, AP } = await import(pathToFileURL(f).href);
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
process.stdout.write(JSON.stringify(out));
