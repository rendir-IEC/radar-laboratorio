"""Examen de entrada de la zona de prácticas del servidor.

Cada idea con la que puede nacer un alumno (la gramática de prAzar y prMuta del servidor: señal, plazos, forma,
modo, lado, filtro y reajuste) se repasa en los últimos 2 años con las mismas reglas que el servidor (escala por
volatilidad, banda sin operar, funding) y el coste prudente del laboratorio (comisión + deslizamiento), en las 20
monedas cripto del servidor. Con cada riesgo (×1, ×2, ×3, ×5, ×10) aprueba si en esos 2 años no pierde dinero y
nunca se queda con menos de la mitad (que en la zona de prácticas es quiebra).

El servidor lo lee y, desde la v2.10.0, solo deja nacer alumnos que aprueban con su riesgo. Los concentrados (todo
en 1 o 3 monedas) se examinan con la misma idea repartida entre todas: es una condición necesaria, no suficiente.

Uso: python -m lab.examen --panel datos/panel.npz --salida /tmp/res/examen.json [--dias 730]
"""
import argparse
import datetime as dt
import itertools
import json
import math
import os
import time

import numpy as np

from .comun import COMISION, DESLIZAMIENTO, H, MONEDAS_SERVIDOR, SPANS
from .datos import cargar_panel
from .senales import memoria
from .simular import correr, preparar

RIESGOS = [1, 2, 3, 5, 10]
QUIEBRA = math.log(0.5)


def gramatica():
    """Todas las ideas que pueden nacer en la zona de prácticas (servidor: prAzar, prMuta y prLimpia)."""
    bases = [{'senal': 'cruce', 'a': a, 'b': b} for a, b in itertools.combinations(SPANS, 2)]
    bases += [{'senal': 'impulso', 'a': a} for a in SPANS] + [{'senal': 'rebote', 'a': a} for a in SPANS]
    bases += [{'senal': s, 'a': a} for s in ('funding_contra', 'funding_sigue') for a in (24, 168)]
    bases.append({'senal': 'tendencia_mixta', 'a': 12, 'b': 720})
    formas = [{'forma': 'signo'}] + [{'forma': 'continua', 'k': k} for k in (0.5, 1, 2)]
    out = []
    for b in bases:
        for fo in formas:
            for modo in ('serie', 'seccion'):
                for lado in ('ambos', 'largos', 'cortos'):
                    for filtro in ('ninguno', 'btc_alcista', 'btc_bajista'):
                        for cada in (1, 24):
                            out.append(dict(b, **fo, modo=modo, lado=lado, filtro=filtro, cada=cada))
    return out


def ident(e):
    """Igual que apLabIdent del servidor (k como String() de JavaScript: 0.5, 1, 2)."""
    p = [e['senal'], str(e['a'])]
    if 'b' in e:
        p.append(str(e['b']))
    p.append('s' if e['forma'] == 'signo' else 'c%g' % e['k'])
    p += [e['modo'][:3], e['lado'][:3], {'ninguno': 'nf', 'btc_alcista': 'ba', 'btc_bajista': 'bb'}[e['filtro']], 'h%d' % e['cada']]
    return '_'.join(p)


def nota(r):
    """r: rendimientos horarios netos con riesgo ×1. Devuelve (máscara de riesgos aprobados, resultado % por riesgo)."""
    mascara, rents = 0, []
    for i, R in enumerate(RIESGOS):
        lg = np.cumsum(np.log(np.maximum(1 + R * r, 1e-12)))
        final = float(lg[-1]) if len(lg) else 0.0
        aprueba = len(lg) > 0 and final >= 0 and float(lg.min()) > QUIEBRA
        if aprueba:
            mascara |= 1 << i
        rents.append(round(math.expm1(final) * 100, 1))
    return mascara, rents


def examinar(panel, dias=730, limite=0):
    M = memoria(panel)
    R, Fsig, hora = preparar(panel)
    monedas = panel['monedas']
    cols = [monedas.index(m) for m in MONEDAS_SERVIDOR if m in monedas]
    if 'BTC' not in [monedas[c] for c in cols]:
        raise SystemExit('Falta BTC en el panel')
    Mu = {'lp': M['lp'][:, cols], 'ema': {s: v[:, cols] for s, v in M['ema'].items()}, 'sig': M['sig'][:, cols],
          'fe24': M['fe24'][:, cols], 'fe168': M['fe168'][:, cols], 'lista': M['lista'][:, cols]}
    Ru, Fu = R[:, cols], Fsig[:, cols]
    i_btc = [monedas[c] for c in cols].index('BTC')
    t = panel['t']
    fin = len(t) - 1  # la última hora no tiene la siguiente
    ini = int(np.searchsorted(t, t[fin] - dias * 24 * H))
    coste = COMISION + DESLIZAMIENTO
    specs = gramatica()
    if limite:
        specs = specs[:limite]
    tabla, aprueban = {}, [0] * len(RIESGOS)
    for e in specs:
        r, _, _ = correr(e, Mu, Ru, Fu, hora, i_btc, coste)
        mask, rents = nota(r[ini:fin])
        tabla[ident(e)] = [mask] + rents
        for i in range(len(RIESGOS)):
            aprueban[i] += (mask >> i) & 1
    f = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%d')
    return {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'version': 1,
        'aviso': 'Investigación en papel: resultados pasados con costes estimados; aprobar no garantiza nada.',
        'regla': 'Aprueba con un riesgo si en la ventana no pierde dinero y nunca baja de la mitad (quiebra).',
        'ventana': {'desde': f(int(t[ini])), 'hasta': f(int(t[fin])), 'dias': dias, 'horas': int(fin - ini)},
        'universo': [monedas[c] for c in cols], 'coste_por_giro_pct': round(coste * 100, 4), 'riesgos': RIESGOS,
        'formato': 'ident: [máscara de riesgos aprobados (bit i = riesgos[i]), resultado % con ×1, ×2, ×3, ×5, ×10]',
        'resumen': {'ideas': len(tabla), 'aprueban': {('x%d' % R): n for R, n in zip(RIESGOS, aprueban)}},
        'ideas': tabla,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', default='datos/panel.npz')
    ap.add_argument('--salida', default='/tmp/res/examen.json')
    ap.add_argument('--dias', type=int, default=730)
    ap.add_argument('--limite', type=int, default=0)
    a = ap.parse_args()
    t0 = time.time()
    r = examinar(cargar_panel(a.panel), a.dias, a.limite)
    os.makedirs(os.path.dirname(a.salida) or '.', exist_ok=True)
    with open(a.salida, 'w') as f:
        json.dump(r, f, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'ventana': r['ventana'], 'resumen': r['resumen'], 'segundos': round(time.time() - t0, 1)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
