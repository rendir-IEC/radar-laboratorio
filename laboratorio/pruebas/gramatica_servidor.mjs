// Identificadores del servidor (apLabIdent) para unas ideas dadas y miles de ideas nacidas como en la zona de
// prácticas (prAzar y prMuta). Uso: node pruebas/gramatica_servidor.mjs ideas.json → JSON. Lo usa prueba_examen.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const fuente = fs.readFileSync(new URL('../../servidor/worker.js', import.meta.url), 'utf8') + '\nexport { apLabIdent, apLabValida, prAzar, prMuta };\n';
const tmp = path.join(os.tmpdir(), 'worker_gram_' + process.pid + '.mjs');
fs.writeFileSync(tmp, fuente);
const W = await import(tmp);
fs.unlinkSync(tmp);
const ideas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const P = { semilla: 12345 };
const nacidas = [];
let sp = W.prAzar(P);
for (let i = 0; i < 20000; i++) {
  sp = i % 3 === 0 ? W.prAzar(P) : W.prMuta(P, sp);
  if (W.apLabValida(sp)) nacidas.push(W.apLabIdent(sp));
}
process.stdout.write(JSON.stringify({ idents: ideas.map((e) => W.apLabIdent(e)), validas: ideas.map((e) => W.apLabValida(e)), nacidas }));
