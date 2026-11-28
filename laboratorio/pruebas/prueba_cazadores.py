"""Pruebas sin red del examen de los cazadores (lab/cazadores.py).

1. Paridad: el repaso del laboratorio da, hora a hora, exactamente lo mismo que czPaso del servidor (worker.js)
   en un mercado sintético con saltos de funding, mercados que aparecen y desaparecen, volumen que cruza los
   umbrales y huecos de horas.
2. Sin mirar al futuro: con el cobro real (el de la hora siguiente) el resultado cambia solo por lo cobrado.
3. Entre exchanges: cuentas de una pareja, lado, umbrales, volumen en los dos sitios y costes.
"""
import json
import math
import os
import random
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lab import cazadores as cz  # noqa: E402
from lab.comun import H  # noqa: E402

fallos = 0


def check(ok, msg):
    global fallos
    print(('OK    ' if ok else 'FALLO ') + msg)
    if not ok:
        fallos += 1


def sintetico(horas=400, semilla=7):
    rnd = random.Random(semilla)
    nombres = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'kPEPE', 'LLL']
    px = {m: 10 + 5 * i for i, m in enumerate(nombres)}
    base = {m: rnd.choice([0.11, 0.3, 0.6, 1.2, -0.4, -0.9, 0.05, 2.0]) for m in nombres}
    vol = {m: rnd.choice([3e5, 2e6, 4e6, 8e6, 2e7]) for m in nombres}
    out = []
    t = 1_780_000_000_000 // H * H
    for i in range(horas):
        t += H * (2 if i in (50, 51, 200) else 1)  # algún hueco de horas
        M = {}
        for m in nombres:
            if m == 'FFF' and 120 <= i < 160:
                continue  # desaparece un rato
            if m == 'GGG' and i < 80:
                continue  # aparece tarde
            if rnd.random() < 0.03:
                base[m] = rnd.choice([0.11, 0.3, 0.6, 1.2, -0.4, -0.9, 0.05, 2.5, -1.5])
            if rnd.random() < 0.02:
                vol[m] = rnd.choice([3e5, 2e6, 4e6, 8e6, 2e7, 3e6])
            pico = rnd.choice([0, 0, 0, 0, 3.0, -2.0]) if rnd.random() < 0.05 else 0
            f = (base[m] + pico + rnd.gauss(0, 0.15)) / 8760
            px[m] *= math.exp(rnd.gauss(0, 0.01) - 0.3 * f * 8760 / 8760)
            M[m] = {'px': round(px[m], 6), 'f': f, 'vol': vol[m] * (1 + rnd.gauss(0, 0.05))}
        out.append((t, M))
    return out


# 1) paridad con el servidor
horas = sintetico()
with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
    json.dump([{'t': t, 'M': M} for t, M in horas], f)
    ruta = f.name
node = subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'paridad_cazadores.mjs'), ruta], capture_output=True, text=True)
os.unlink(ruta)
check(node.returncode == 0, 'el servidor corre las mismas horas' + ('' if node.returncode == 0 else ': ' + node.stderr[-500:]))
S = json.loads(node.stdout) if node.returncode == 0 else {'cz': {}, 'eq': {}, 'pesos': {}, 'pasos': []}
C = cz.nuevo(horas[0][0])
pasos = []
for t, M in horas:
    cz.paso(C, M, t)
    pasos.append({c['id']: ','.join(C['cz'][c['id']]['pos']) for c in cz.CAZADORES})
iguales = sum(1 for a, b in zip(pasos, S['pasos']) if a == b)
check(iguales == len(horas), 'las mismas posiciones hora a hora: %d de %d horas' % (iguales, len(horas)))
for c in cz.CAZADORES:
    a, b = C['cz'][c['id']]['st'], S['cz'].get(c['id'], {}).get('st', {})
    ok = b and a['n'] == b['n'] and abs(a['log'] - b['log']) < 1e-11 and abs(a['dd'] - b['dd']) < 1e-11
    check(ok, 'paridad %s: %d h, %.6f %% (servidor %.6f %%)' % (c['id'], a['n'], math.expm1(a['log']) * 100, math.expm1(b.get('log', float('nan'))) * 100))
check(abs(C['eq']['st']['log'] - S['eq'].get('log', 1)) < 1e-11, 'paridad del equipo: %.6f %%' % (math.expm1(C['eq']['st']['log']) * 100))
w = cz.pesos(C, cz.CAZADORES)
check(all(abs(w[k] - S['pesos'][k]) < 1e-12 for k in w), 'los mismos pesos en el equipo')
dentro = sum(1 for c in cz.CAZADORES if C['cz'][c['id']]['horasDentro'] > 0)
check(dentro >= 6, 'la prueba ejercita a casi todos: %d de 8 han tenido posición' % dentro)

# 2) sin mirar al futuro: con el cobro de la hora siguiente cambia el resultado de los cubiertos y no sus decisiones
cobros = [{m: M[m]['f'] * 0 + 0.5 / 8760 for m in M} for _, M in horas]  # cobro fijo del 50 % al año
C2, s2 = cz.repasar(horas, cz.CAZADORES, cobros)
iguales = all(','.join(C2['cz'][c['id']]['pos']) == pasos[-1][c['id']] for c in cz.CAZADORES)
check(iguales, 'el cobro de la hora siguiente no cambia las decisiones (se decide con lo ya pagado)')
c20, c20b = C['cz']['cz_cob_20'], C2['cz']['cz_cob_20']
check(c20['st']['log'] != c20b['st']['log'] and c20b['st']['n'] == c20['st']['n'], 'pero sí lo cobrado: %.4f %% frente a %.4f %%' % (math.expm1(c20b['st']['log']) * 100, math.expm1(c20['st']['log']) * 100))
check(len(s2['cz_cob_20']) == c20b['st']['n'] and len(s2['equipo']) == C2['eq']['st']['n'], 'series por hora completas')

# 3) entre exchanges
t0 = 1_780_000_000_000 // H * H
pareja = lambda fh, fk, ph=100.0, pk=100.0, vh=5e6, vk=1e6: {'ph': ph, 'pk': pk, 'fh': fh / 8760, 'fk': fk / 8760, 'volh': vh, 'volk': vk}
hs = [(t0 + i * H, {'XXX': pareja(0.8, 0.1), 'YYY': pareja(-0.6, 0.1), 'ZZZ': pareja(0.3, 0.2), 'POCA': pareja(2.0, 0.0, vk=1e5)}) for i in range(30)]
E, se = cz.repasar(hs, entre=True)
p50 = E['cz']['cz_entre_50']['pos']
check(p50.get('XXX', 0) > 0 and p50.get('YYY', 0) < 0 and 'ZZZ' not in p50, 'entre 50 %: vende donde se cobra más (XXX: +1/3) y al revés en YYY (−1/3); ZZZ no llega')
check('POCA' not in E['cz']['cz_entre_20']['pos'], 'sin volumen en Kraken no entra aunque la diferencia sea enorme')
check(not E['cz']['cz_entre_100']['pos'], 'solo extremos: ninguna llega al 100 %')
st = E['cz']['cz_entre_50']['st']
# la hora 13 (la primera con 12 h de media) entra; desde la 14 cobra (0,7 + 0,7) % / 8760 · 1/3 · 2/3 cada hora
ent = 2 / 3 * cz.PARTE_ENTRE * cz.COSTE_LADO
cada = (1 / 3) * cz.PARTE_ENTRE * ((0.8 - 0.1) + (0.1 + 0.6)) / 8760
esperado = math.log(1 + cada - ent) + (len(hs) - 13) * math.log(1 + cada)
check(abs(st['log'] - esperado) < 1e-12, 'cuentas entre exchanges: %.5f %% (esperado %.5f %%)' % (math.expm1(st['log']) * 100, math.expm1(esperado) * 100))
# si Kraken sube un 1 % y Hyperliquid no, gana la pareja que compra en Kraken
hs2 = hs + [(t0 + 30 * H, {'XXX': pareja(0.8, 0.1, pk=101.0), 'YYY': pareja(-0.6, 0.1, pk=101.0), 'ZZZ': pareja(0.3, 0.2), 'POCA': pareja(2.0, 0.0, vk=1e5)})]
E2, _ = cz.repasar(hs2, entre=True)
d = math.expm1(E2['cz']['cz_entre_50']['st']['log'] - st['log'])
esperado = (1 / 3) * cz.PARTE_ENTRE * ((0.7 + 0.7) / 8760 + 0.01 - 0.01)
check(abs(d - esperado) < 1e-12, 'la diferencia de precio entre sitios cuenta: XXX gana el 1 %% de Kraken e YYY lo pierde (%.6f)' % d)

# métricas e informe
filas, eq = cz.resumen(C, {**{c['id']: [] for c in cz.CAZADORES}, 'equipo': []}, cz.CAZADORES, len(horas))
check(len(filas) == 8 and all('rent_pct' in f for f in filas), 'resumen de los 8')
r = cz.estudiar(horas[:200], [None] * 200, horas, [{} for _ in horas], hs, [None] * len(hs), {'desde_funding': horas[0][0], 'desde_precio': horas[0][0], 'hasta': horas[-1][0]}, {'universo': 12})
txt = cz.informe(r)
check('Entre exchanges' in txt and 'Equipo' in txt and len(r['periodos']) == 3, 'informe con los tres repasos')
check('NaN' not in json.dumps(r), 'sin NaN')
# funding de Kraken cada 4 h se reparte entre sus horas
filas_k = [(t0 + i * 4 * H, 0.0004) for i in range(5)]
fk = sorted(set((t - k * H, r / 4) for t, r in filas_k for k in range(4)))
check(len(fk) == 20 and abs(fk[0][1] - 0.0001) < 1e-15, 'funding de Kraken cada 4 h: una cuarta parte en cada hora')
check(cz.base_kraken('PF_1000PEPEUSD') == ('PEPE', 1000) and cz.base_hl('kPEPE') == ('PEPE', 1000) and cz.base_kraken('PF_XBTUSD') == ('BTC', 1), 'nombres de las monedas en los dos sitios')

print(('%d FALLOS' % fallos) if fallos else 'todo OK')
sys.exit(1 if fallos else 0)
