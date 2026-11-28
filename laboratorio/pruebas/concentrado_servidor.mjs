// La cartera que mantiene cada hora un alumno concentrado del servidor (prConcentra + banda de prPaso, riesgo 1) para
// unas ideas y concentraciones dadas. Lo usa prueba_examen.py (paridad con objetivo_concentrado del laboratorio).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const raiz = new URL('../../servidor/worker.js', import.meta.url);
let src = readFileSync(raiz, 'utf8').replace('export default {', 'const __porDefecto = {');
src += '\nexport { apPaso, apEstadoNuevo, apLabPosiciones, prConcentra, AP, H1 };\n';
const f = join(mkdtempSync(join(tmpdir(), 'conc-')), 'w.mjs');
writeFileSync(f, src);
const W = await import(pathToFileURL(f).href);
const ent = JSON.parse(readFileSync(0, 'utf8'));
const E = W.apEstadoNuevo();
E._silencio = true;
const alumnos = ent.casos.map(([sp, conc]) => ({ spec: sp, conc, riesgo: 1, pos: {}, tUlt: null }));
const camino = alumnos.map(() => []);
for (let k = 0; k < ent.t.length; k++) {
  const px = {}, fr = {};
  for (const [m, s] of Object.entries(ent.P)) if (s[k] != null) px[m] = s[k];
  for (const [m, s] of Object.entries(ent.F)) if (s[k] != null) fr[m] = s[k];
  W.apPaso(E, { t: ent.t[k], px, f: fr, historia: true });
  const t = ent.t[k];
  const listas = W.AP.MERCADOS.filter((m) => E.monedas[m] && E.monedas[m].n >= W.AP.HORAS_MIN && px[m] > 0);
  alumnos.forEach((A, i) => {
    const sp = A.spec;
    let nueva;
    if (sp.cada > 1 && A.tUlt != null && Math.floor(t / W.H1) % sp.cada !== 0) nueva = A.pos;
    else {
      const base = W.apLabPosiciones(E, { id: '__practicas', spec: sp }, listas, t) || {};
      nueva = W.prConcentra(E, A, base);
      const objetivo = { ...nueva };
      for (const m of Object.keys(nueva)) { const o = A.pos[m]; if (o && Math.sign(o) === Math.sign(nueva[m]) && Math.abs(nueva[m] - o) < W.AP.BANDA * Math.abs(o)) nueva[m] = o; }
      if (Object.values(nueva).reduce((a, b) => a + Math.abs(b), 0) > A.riesgo + 1e-9) Object.assign(nueva, objetivo);
    }
    A.pos = nueva; A.tUlt = t;
    camino[i].push(nueva);
  });
}
process.stdout.write(JSON.stringify(camino));
