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
res = ex.examinar(panel, dias=200, limite=40, con_concentrados=False)
check(len(res['ideas']) == 40 and all(len(v) == 6 for v in res['ideas'].values()), 'examen: 40 ideas con máscara y 5 resultados')
check(res['ventana']['dias'] == 200 and 4700 <= res['ventana']['horas'] <= 4801, 'ventana de los últimos 200 días: %d horas' % res['ventana']['horas'])
check(set(res['ideas']) <= set(ids) and res['riesgos'] == [1, 2, 3, 5, 10], 'claves = identificadores del servidor')
check('NaN' not in json.dumps(res), 'sin NaN')
a1 = res['resumen']['aprueban']
check(a1['x1'] >= a1['x10'], 'aprueban más con ×1 (%d) que con ×10 (%d)' % (a1['x1'], a1['x10']))

# concentrados: el laboratorio mantiene hora a hora la misma cartera que un alumno concentrado del servidor
from lab.comun import BANDA, H  # noqa: E402
from lab.senales import memoria  # noqa: E402
from lab.simular import camino  # noqa: E402
T = 1300
tt = (1_700_000_000_000 // H + 3) * H + H * np.arange(T)
hora = ((tt // H) % 24).astype(np.int64)
monedas = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB']
rng = np.random.default_rng(5)
P = np.exp(np.cumsum(rng.normal(0, 0.01, (T, len(monedas))), axis=0)) * 50
F = rng.normal(1e-5, 4e-5, (T, len(monedas)))
P[1000:1003, 2] = np.nan
F[1000:1003, 2] = np.nan
P[:250, 5] = np.nan
F[:250, 5] = np.nan
casos = [(e, c) for e in [g for g in G if g['senal'] == 'funding_contra'][::7] + [G[i] for i in rng.choice(len(G), 12, replace=False)] for c in (1, 3)]
casos.append(({'senal': 'funding_contra', 'a': 24, 'forma': 'signo', 'modo': 'serie', 'lado': 'ambos', 'filtro': 'ninguno', 'cada': 1}, 1))
lista = lambda a: [None if not np.isfinite(x) else float(x) for x in a]
ent = {'t': tt.tolist(), 'P': {m: lista(P[:, j]) for j, m in enumerate(monedas)}, 'F': {m: lista(F[:, j]) for j, m in enumerate(monedas)}, 'casos': casos}
r = subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'concentrado_servidor.mjs')], input=json.dumps(ent), capture_output=True, text=True)
check(r.returncode == 0, 'el servidor corre los alumnos concentrados' + ('' if r.returncode == 0 else ': ' + r.stderr[-400:]))
cam = json.loads(r.stdout) if r.returncode == 0 else []
M = memoria({'t': tt, 'P': P, 'Finfo': F})
peor, activas = 0.0, 0
for (e, c), cs in zip(casos, cam):
    lab = camino(ex.objetivo_concentrado(e, M, 0, c, monedas), hora, int(e['cada']), BANDA)
    srv = np.array([[(x or {}).get(m, 0.0) for m in monedas] for x in cs])
    d = np.abs(lab - srv).max(axis=1)
    if d.max() > 1e-9 and peor <= 1e-9:
        k = int(np.argmax(d > 1e-9))
        print('     primera diferencia:', ex.ident(e), 'c', c, 'hora', k, 'lab', np.round(lab[k], 4).tolist(), 'srv', np.round(srv[k], 4).tolist())
    peor = max(peor, float(np.abs(lab - srv).max()))
    activas += int((np.abs(lab).sum(axis=1) > 0).sum())
check(len(cam) == len(casos) and peor < 1e-9 and activas > 1000, 'concentrados: la misma cartera hora a hora que el servidor en %d casos (diferencia máxima %.1e; %d horas con posición)' % (len(casos), peor, activas))

# la línea contra el funding y los concentrados en el examen
res = ex.examinar(panel, dias=200, limite=12)
check(any(k.endswith('_c1') for k in res['ideas']) and len(res['ideas']) == 36, 'examen con concentrados: 12 ideas × (repartida, 3 monedas, 1 moneda)')
L = res['linea_contra_funding']['filas']
check(len(L) == 2 * (2 + 4 + 4) and all('dos_anos' in x and 'toda_la_historia' in x for x in L), 'la línea contra el funding: %d variantes con 2 años y toda la historia' % len(L))
x5 = [x for x in L if x['concentracion'] == 1 and x['riesgo'] == 5 and '1 día' in x['idea']][0]
check({'rent_pct', 'caida_max_pct', 'quiebra', 'peor_semana_pct', 'por_ano_pct'} <= set(x5['dos_anos']), 'la del alumno (1 día, 1 moneda, ×5): ' + json.dumps(x5['dos_anos'], ensure_ascii=False)[:160])
check('NaN' not in json.dumps(res), 'sin NaN (con concentrados)')
res2 = ex.examinar(panel, dias=200, limite=0, con_concentrados=False)
S = res2['sugeridas']
check(len(S) <= 3 and all(x['spec']['senal'] == 'funding_contra' and x['riesgo'] == 5 and (res2['ideas'][x['ident']][0] >> 3) & 1 for x in S), 'sugeridas: hasta 3 variantes contra el funding que aprueban con ×5 (%d: %s)' % (len(S), ', '.join(x['ident'] for x in S)))
check(len({(x['spec']['a'], x['spec']['modo'], x['spec']['lado'], x['spec']['filtro'], x['spec']['cada']) for x in S}) == len(S), 'sin repetir la misma combinación')

print(('%d FALLOS' % fallos) if fallos else 'todo OK')
sys.exit(1 if fallos else 0)
