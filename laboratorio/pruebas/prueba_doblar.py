"""Pruebas sin red del estudio «¿se puede doblar en 3 días?» (lab/doblar.py): la carrera de cada apuesta, que los
rasgos no miran al futuro, que en un mercado sin ventaja no aprueba nada y que, si la ventaja existe, la encuentra."""
import json
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lab import doblar as db  # noqa: E402
from lab.comun import MONEDAS_SERVIDOR  # noqa: E402
from lab.sintetico import panel_sintetico  # noqa: E402

fallos = 0


def check(ok, msg):
    global fallos
    print(('OK    ' if ok else 'FALLO ') + msg)
    if not ok:
        fallos += 1


H72 = db.HORAS
F0 = np.zeros(H72)
sube = 100 * (1 + 0.001 * np.arange(1, H72 + 1))  # +7,2 % en 72 h, poco a poco
r, ty = db.carrera(100.0, sube, F0, 1, 40)
check(ty == 'dobla' and r == 1.0, 'compra ×40 y el precio sube un 2,6 %%: dobla (%s)' % ty)
r, ty = db.carrera(100.0, sube, F0, -1, 40)
check(ty == 'quiebra' and r == -1.0, 'vende ×40 y sube: quiebra (%s)' % ty)
r, ty = db.carrera(100.0, np.full(H72, 100.0), F0, 1, 20)
c = (db.TOMA + db.DESLIZ) * 20 * 2
check(ty == 'nada' and abs(r + c) < 1e-12, 'precio quieto: ni una ni otra y se pagan las comisiones (%.2f %%)' % (r * 100))
r, ty = db.carrera(100.0, np.full(H72, 100.0), np.full(H72, 0.0001), 1, 10)
check(ty == 'nada' and abs(r - (-c / 2 - 10 * 0.0001 * H72)) < 1e-12, 'el funding cuenta: comprado paga %.2f %%' % (r * 100))
check(len(db.reglas()) == 138, 'reglas probadas: %d' % len(db.reglas()))

# sin mirar al futuro
p = panel_sintetico(MONEDAS_SERVIDOR[:8], horas=24 * 200, semilla=4)
P, F = p['P'][:, :8], np.nan_to_num(p['Finfo'][:, :8])
i = 24 * 100
a = db.rasgos(P, F, i)
P2, F2 = P.copy(), F.copy()
P2[i + 1:] *= 3.0
F2[i + 1:] += 0.01
b = db.rasgos(P2, F2, i)
check(all(np.allclose(a[k], b[k], equal_nan=True) for k in a), 'los rasgos de un día no cambian si cambia el futuro')

# sin ventaja: nada aprueba
t0 = time.time()
ruido = panel_sintetico(MONEDAS_SERVIDOR, horas=24 * 365 * 4, mundo='ruido', semilla=11)
r0 = db.estudiar(ruido, dias_examen=365)
print('      (%.0f s)' % (time.time() - t0))
check(not r0['aprueba'], 'mercado sin ventaja: la elegida no aprueba (t examen %s; exigida %s)' % (r0['elegida']['examen_2_anos'].get('t'), r0['t_exigida']))
check(r0['examen_todas']['superan_t_exigida'] <= 2, 'casi ninguna supera la t exigida por azar: %d de %d' % (r0['examen_todas']['superan_t_exigida'], r0['examen_todas']['reglas']))
check(r0['kelly']['parte_por_apuesta_pct'] <= 10, 'Kelly sin ventaja: apostar poco o nada (%s %%)' % r0['kelly']['parte_por_apuesta_pct'])
# con ventaja fuerte y conocida: la encuentra
imp = panel_sintetico(MONEDAS_SERVIDOR, horas=24 * 365 * 4, mundo='impulso', fuerza=0.08, semilla=11)
r1 = db.estudiar(imp, dias_examen=365)
e = r1['elegida']
check(r1['aprueba'] and e['signo'] == 1 and e['rasgo'].startswith('imp'), 'mercado con impulso: encuentra una regla que sigue el impulso y aprueba (%s; t examen %s)' % (e['regla'], e['examen_2_anos'].get('t')))
check((r1['kelly']['dias_para_duplicar'] or 0) > 0, 'y Kelly da un ritmo para duplicar: %s días' % r1['kelly']['dias_para_duplicar'])
txt = db.informe(r1)
check('Aprueba' in txt and 'Kelly' in txt and 'NaN' not in json.dumps(r1), 'informe y sin NaN')

print(('%d FALLOS' % fallos) if fallos else 'todo OK')
sys.exit(1 if fallos else 0)
