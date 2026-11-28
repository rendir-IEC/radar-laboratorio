"""Pruebas sin red del examen de entrada (lab/examen.py): la gramática es la del servidor (mismos identificadores,
y todo lo que puede nacer está en la tabla), la nota (no perder y no quebrar con cada riesgo) y el examen completo
sobre un panel sintético."""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lab import examen as ex  # noqa: E402
from lab.comun import MONEDAS_SERVIDOR  # noqa: E402
from lab.sintetico import panel_sintetico  # noqa: E402

fallos = 0


def check(ok, msg):
    global fallos
    print(('OK    ' if ok else 'FALLO ') + msg)
    if not ok:
        fallos += 1


G = ex.gramatica()
ids = [ex.ident(e) for e in G]
check(len(G) == 4608 and len(set(ids)) == len(G), 'la gramática de los alumnos: %d ideas distintas' % len(G))
with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
    json.dump(G, f)
    ruta = f.name
r = subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'gramatica_servidor.mjs'), ruta], capture_output=True, text=True)
os.unlink(ruta)
check(r.returncode == 0, 'el servidor lee las ideas' + ('' if r.returncode == 0 else ': ' + r.stderr[-400:]))
S = json.loads(r.stdout) if r.returncode == 0 else {'idents': [], 'validas': [], 'nacidas': []}
check(S['idents'] == ids, 'los mismos identificadores que el servidor (apLabIdent) en las %d' % len(ids))
check(all(S['validas']), 'el servidor las da todas por válidas')
fuera = set(S['nacidas']) - set(ids)
check(len(S['nacidas']) > 10000 and not fuera, 'todo lo que nace en el servidor tiene examen: %d nacidas, %d distintas, %d sin examen %s' % (
    len(S['nacidas']), len(set(S['nacidas'])), len(fuera), sorted(fuera)[:3]))

# la nota
m, rents = ex.nota(np.full(1000, 0.0001))
check(m == 0b11111 and rents[0] > 0, 'gana un poco cada hora: aprueba con todos los riesgos')
r = np.concatenate([np.full(10, -0.007), np.full(500, 0.0003)])  # cae un 7 % y se recupera de sobra
m, rents = ex.nota(r)
check(m & 1 and m & 2 and m & 4 and not (m >> 4) & 1, 'cae un 7 %% y se recupera: aprueba con ×1, ×2 y ×3; con ×10 quiebra (máscara %s, ×10 %s %%)' % (bin(m), rents[4]))
m, _ = ex.nota(np.full(500, -0.00001))
check(m == 0, 'pierde poco pero pierde: suspende con todos')
m, _ = ex.nota(np.array([]))
check(m == 0, 'sin horas no aprueba')

# examen completo en un panel sintético con algunas ideas
panel = panel_sintetico(MONEDAS_SERVIDOR[:8], horas=24 * 400, mundo='ruido', semilla=3)
res = ex.examinar(panel, dias=200, limite=40)
check(len(res['ideas']) == 40 and all(len(v) == 6 for v in res['ideas'].values()), 'examen: 40 ideas con máscara y 5 resultados')
check(res['ventana']['dias'] == 200 and 4700 <= res['ventana']['horas'] <= 4801, 'ventana de los últimos 200 días: %d horas' % res['ventana']['horas'])
check(set(res['ideas']) <= set(ids) and res['riesgos'] == [1, 2, 3, 5, 10], 'claves = identificadores del servidor')
check('NaN' not in json.dumps(res), 'sin NaN')
a1 = res['resumen']['aprueban']
check(a1['x1'] >= a1['x10'], 'aprueban más con ×1 (%d) que con ×10 (%d)' % (a1['x1'], a1['x10']))

print(('%d FALLOS' % fallos) if fallos else 'todo OK')
sys.exit(1 if fallos else 0)
