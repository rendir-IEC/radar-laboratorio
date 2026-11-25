// Corre apPaso de servidor/worker.js hora a hora con estrategias del laboratorio cargadas en E.lab y devuelve la
// cartera que el servidor TIENE cada hora para cada una (con la banda sin operar y el reajuste cada 24 h).
// Lo usa prueba_lab.py (test_camino_igual_que_el_servidor).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const raiz = new URL('../../servidor/worker.js', import.meta.url);
let src = readFileSync(raiz, 'utf8').replace('export default {', 'const __porDefecto = {');
src += '\nexport { apPaso, apEstadoNuevo };\n';
const f = join(mkdtempSync(join(tmpdir(), 'cam-')), 'w.mjs');
writeFileSync(f, src);
const { apPaso, apEstadoNuevo } = await import(pathToFileURL(f).href);
const ent = JSON.parse(readFileSync(0, 'utf8'));
const E = apEstadoNuevo();
E._silencio = true;
E.lab = { specs: ent.specs.map((sp, i) => ({ id: 'lab_p' + i, nombre: 'p' + i, aprobada: false, spec: sp })) };
const camino = ent.specs.map(() => []);
for (let k = 0; k < ent.t.length; k++) {
  const px = {}, fr = {};
  for (const [m, s] of Object.entries(ent.P)) if (s[k] != null) px[m] = s[k];
  for (const [m, s] of Object.entries(ent.F)) if (s[k] != null) fr[m] = s[k];
  apPaso(E, { t: ent.t[k], px, f: fr, historia: true });
  ent.specs.forEach((_, i) => { const X = E.expertos['lab_p' + i]; camino[i].push(X ? X.pos : null); });
}
process.stdout.write(JSON.stringify(camino));
