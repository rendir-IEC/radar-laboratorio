"""Estudio: ¿se puede doblar en 3 días?

Apuesta de «doblar o perder» con apalancamiento ×10, ×20 o ×40 en un perpetuo: se gana la apuesta si el dinero llega
al doble antes de 72 h, se pierde si llega a la liquidación, y si no pasa ninguna de las dos se cierra a las 72 h.
Comisión de toma (0,045 %) y deslizamiento (0,025 %) al entrar y al salir, funding hora a hora y margen de
mantenimiento del 1,25 % del nominal. Precios de cierre horario: las mechas dentro de la hora no se ven, así que la
liquidación real llega antes (el estudio es optimista para la apuesta).

Cada día a las 0:00 UTC, cada regla elige moneda y dirección con lo que se sabe en ese momento: impulso o vuelta de
1, 3, 7 y 30 días, distancia a la media de 20 días, funding de 1 y de 7 días; en Bitcoin, en Ethereum o en la moneda
más extrema de las 20 del servidor. Más las referencias: comprar o vender siempre.

Criterio fijado antes de mirar: las reglas se ordenan con 2021–2024 y se examinan en los 2 últimos años, que no han
visto. Aprueba la elegida si en esos 2 años gana de media por apuesta con una t mayor que la que exige haber probado
todas (Bonferroni al 5 %), contando 1 de cada 3 días como apuestas independientes (duran 3 días).

Si alguna aprueba: el ritmo más rápido al que permite duplicar sin arruinarse (Kelly: la parte del dinero que hay que
apostar cada vez para crecer lo más deprisa posible a largo plazo).

Uso: python -m lab.doblar --panel datos/panel.npz --salida /tmp/res/doblar
"""
import argparse
import datetime as dt
import json
import math
import os
import warnings

import numpy as np

from .comun import H, MONEDAS_SERVIDOR
from .datos import cargar_panel

HORAS = 72
TOMA = 0.00045
DESLIZ = 0.00025
MANT = 0.0125
APALANC = (10, 20, 40)
RASGOS = ('imp1', 'imp3', 'imp7', 'imp30', 'media20', 'fund1', 'fund7', 'siempre')
ELECCION = ('BTC', 'ETH', 'extrema')
NOMBRE_RASGO = {'imp1': 'el movimiento de 1 día', 'imp3': 'el de 3 días', 'imp7': 'el de 7 días', 'imp30': 'el de 30 días',
                'media20': 'la distancia a su media de 20 días', 'fund1': 'el funding de 1 día', 'fund7': 'el funding de 7 días',
                'siempre': 'nada (siempre igual)'}


def carrera(P0, Pc, Fc, s, L):
    """Resultado de una apuesta (en tanto por uno del dinero, de −1 a +1) dadas las 72 h siguientes de precio Pc y de
    funding horario Fc, dirección s (+1 compra, −1 vende) y apalancamiento L."""
    c = TOMA + DESLIZ
    X = Pc / P0 - 1
    E = 1 + L * s * X - L * s * np.cumsum(Fc) - L * c
    sube = np.nonzero(E - L * c >= 2)[0]
    cae = np.nonzero(E <= L * MANT * (1 + X))[0]
    ts = sube[0] if len(sube) else HORAS + 1
    tc = cae[0] if len(cae) else HORAS + 1
    if ts < tc:
        return 1.0, 'dobla'
    if tc < ts:
        return -1.0, 'quiebra'
    return float(max(E[-1] - L * c, 0.0) - 1), 'nada'


def rasgos(P, F, i):
    """Rasgos de cada moneda en la hora i, solo con el pasado."""
    lp = np.log(P)
    out = {}
    for k, d in (('imp1', 1), ('imp3', 3), ('imp7', 7), ('imp30', 30)):
        out[k] = lp[i] - lp[i - 24 * d] if i - 24 * d >= 0 else np.full(P.shape[1], np.nan)
    with np.errstate(invalid='ignore'), warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        out['media20'] = lp[i] - np.log(np.nanmean(P[max(0, i - 480): i + 1], axis=0)) if i >= 480 else np.full(P.shape[1], np.nan)
        out['fund1'] = np.nanmean(F[i - 23: i + 1], axis=0)
        out['fund7'] = np.nanmean(F[i - 167: i + 1], axis=0)
    out['siempre'] = np.ones(P.shape[1])
    return out


def reglas():
    out = []
    for r in RASGOS:
        for s in (1, -1):
            for e in ELECCION:
                if r == 'siempre' and e == 'extrema':
                    continue
                for L in APALANC:
                    out.append({'rasgo': r, 'signo': s, 'eleccion': e, 'L': L})
    return out


def nombre(R):
    lado = ('compra' if R['signo'] > 0 else 'vende') if R['rasgo'] == 'siempre' else ('sigue' if R['signo'] > 0 else 'va contra')
    donde = {'BTC': 'en Bitcoin', 'ETH': 'en Ethereum', 'extrema': 'en la moneda más extrema'}[R['eleccion']]
    if R['rasgo'] == 'siempre':
        return 'Siempre %s %s, ×%d' % (lado, donde, R['L'])
    return '%s %s, %s, ×%d' % (lado.capitalize(), NOMBRE_RASGO[R['rasgo']], donde, R['L'])


def jugar(panel, dias=None):
    """Para cada día y cada regla, el resultado de la apuesta. Devuelve (fechas, reglas, R [dias × reglas], tipo)."""
    monedas = panel['monedas']
    cols = [monedas.index(m) for m in MONEDAS_SERVIDOR if m in monedas]
    nombres = [monedas[c] for c in cols]
    P, t = panel['P'][:, cols], panel['t']
    F = panel['Finfo'][:, cols] if 'Finfo' in panel else np.zeros_like(P)
    F = np.nan_to_num(F, nan=0.0)
    horas_dia = np.nonzero((t // H) % 24 == 0)[0]
    horas_dia = horas_dia[(horas_dia >= 24 * 31) & (horas_dia + HORAS < len(t))]
    RR = reglas()
    res = np.full((len(horas_dia), len(RR)), np.nan)
    tipo = np.full((len(horas_dia), len(RR)), '', dtype=object)
    for d, i in enumerate(horas_dia):
        f = rasgos(P, F, i)
        vivos = np.isfinite(P[i]) & np.all(np.isfinite(P[i + 1: i + 1 + HORAS]), axis=0)
        for k, R in enumerate(RR):
            x = f[R['rasgo']]
            if R['eleccion'] in ('BTC', 'ETH'):
                if R['eleccion'] not in nombres:
                    continue
                j = nombres.index(R['eleccion'])
                if not vivos[j] or not np.isfinite(x[j]) or x[j] == 0:
                    continue
            else:
                ok = vivos & np.isfinite(x)
                if ok.sum() < 5:
                    continue
                z = np.where(ok, (x - np.nanmean(x[ok])) / (np.nanstd(x[ok]) or 1), 0.0)
                j = int(np.argmax(np.abs(z)))
                if z[j] == 0:
                    continue
                x = z
            s = R['signo'] * (1 if R['rasgo'] == 'siempre' else int(np.sign(x[j])))
            res[d, k], tipo[d, k] = carrera(P[i, j], P[i + 1: i + 1 + HORAS, j], F[i + 1: i + 1 + HORAS, j], s, R['L'])
    return t[horas_dia], RR, res, tipo


def medir(r, ty):
    ok = np.isfinite(r)
    r, ty = r[ok], ty[ok]
    n = len(r)
    if n < 30:
        return {'apuestas': int(n)}
    ind = r[::3]  # una de cada 3: las apuestas duran 3 días
    sd = ind.std(ddof=1) if len(ind) > 2 else 0
    return {'apuestas': int(n), 'independientes': int(len(ind)), 'dobla_pct': round(float((ty == 'dobla').mean()) * 100, 1),
            'quiebra_pct': round(float((ty == 'quiebra').mean()) * 100, 1), 'nada_pct': round(float((ty == 'nada').mean()) * 100, 1),
            'media_por_apuesta_pct': round(float(r.mean()) * 100, 2), 't': round(float(ind.mean() / sd * math.sqrt(len(ind))) if sd > 0 else 0.0, 2)}


def kelly(r):
    """Parte del dinero que apostar cada vez para crecer lo más deprisa posible (máximo de la media del logaritmo) y el
    crecimiento por apuesta que da."""
    r = r[np.isfinite(r)][::3]
    if len(r) < 30:
        return 0.0, 0.0
    fs = np.linspace(0, 1, 1001)
    g = np.array([np.mean(np.log(np.maximum(1 + f * r, 1e-12))) for f in fs])
    k = int(np.argmax(g))
    return float(fs[k]), float(g[k])


def estudiar(panel, dias_examen=730):
    fechas, RR, res, tipo = jugar(panel)
    corte = fechas[-1] - dias_examen * 24 * H
    tr, te = fechas < corte, fechas >= corte
    filas = []
    for k, R in enumerate(RR):
        filas.append({'regla': nombre(R), **R, 'eleccion_2021_2024': medir(res[tr, k], tipo[tr, k]), 'examen_2_anos': medir(res[te, k], tipo[te, k])})
    validas = [f for f in filas if f['eleccion_2021_2024'].get('apuestas', 0) >= 100]
    validas.sort(key=lambda f: -f['eleccion_2021_2024']['media_por_apuesta_pct'])
    n_reglas = len(filas)
    from statistics import NormalDist
    t_exigida = NormalDist().inv_cdf(1 - 0.05 / n_reglas)
    elegida = validas[0] if validas else None
    k_el = RR.index({kk: elegida[kk] for kk in ('rasgo', 'signo', 'eleccion', 'L')}) if elegida else None
    f_k, g_k = kelly(res[te, k_el]) if elegida else (0.0, 0.0)
    aprueba = bool(elegida and elegida['examen_2_anos'].get('t', 0) > t_exigida and elegida['examen_2_anos'].get('media_por_apuesta_pct', 0) > 0)
    examen = [f['examen_2_anos'] for f in filas if f['examen_2_anos'].get('apuestas', 0) >= 100]
    f = lambda ms: dt.datetime.fromtimestamp(int(ms) / 1000, dt.timezone.utc).strftime('%Y-%m-%d')
    return {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'version': 1,
        'pregunta': '¿Hay alguna regla que acierte lo bastante la dirección de los próximos 3 días para que doblar o perder con ×10, ×20 o ×40 salga a cuenta?',
        'aviso': 'Investigación en papel con datos pasados; precios de cierre horario (las mechas no se ven: la liquidación real llega antes). No es una recomendación.',
        'periodos': {'eleccion': [f(fechas[0]), f(corte)], 'examen': [f(corte), f(fechas[-1])]},
        'reglas_probadas': n_reglas, 't_exigida': round(t_exigida, 2),
        'elegida': elegida, 'aprueba': aprueba,
        'kelly': {'parte_por_apuesta_pct': round(f_k * 100, 1), 'crecimiento_por_apuesta_pct': round(math.expm1(g_k) * 100, 3),
                  'dias_para_duplicar': round(math.log(2) / g_k * 3, 0) if g_k > 0 else None},
        'examen_todas': {'reglas': len(examen), 'ganan_de_media': sum(1 for x in examen if x['media_por_apuesta_pct'] > 0),
                         'superan_t_exigida': sum(1 for x in examen if x.get('t', 0) > t_exigida),
                         'mejor_dobla_pct': max((x['dobla_pct'] for x in examen), default=None)},
        'top5_eleccion': validas[:5],
        'reglas': filas,
    }


def informe(r):
    e = r['elegida'] or {}
    x, y = e.get('eleccion_2021_2024', {}), e.get('examen_2_anos', {})
    L = ['# ¿Se puede doblar en 3 días?', '', '_' + r['aviso'] + '_', '', r['pregunta'], '',
         'Elección: %s → %s. Examen (no visto): %s → %s. Reglas probadas: %d. t exigida: %.2f.' % (
             r['periodos']['eleccion'][0], r['periodos']['eleccion'][1], r['periodos']['examen'][0], r['periodos']['examen'][1], r['reglas_probadas'], r['t_exigida']), '',
         '## La regla elegida con 2021–2024', '', '**%s**' % e.get('regla', '—'), '',
         '| | Dobla | Quiebra | Ni una ni otra | Media por apuesta | t |', '|---|---:|---:|---:|---:|---:|',
         '| 2021–2024 | %s %% | %s %% | %s %% | %s %% | %s |' % (x.get('dobla_pct'), x.get('quiebra_pct'), x.get('nada_pct'), x.get('media_por_apuesta_pct'), x.get('t')),
         '| Examen | %s %% | %s %% | %s %% | %s %% | %s |' % (y.get('dobla_pct'), y.get('quiebra_pct'), y.get('nada_pct'), y.get('media_por_apuesta_pct'), y.get('t')),
         '', '**Aprueba: %s.**' % ('sí' if r['aprueba'] else 'no'), '',
         'Kelly en el examen: apostar el %s %% del dinero cada vez; crece %s %% por apuesta; días para duplicar: %s.' % (
             r['kelly']['parte_por_apuesta_pct'], r['kelly']['crecimiento_por_apuesta_pct'], r['kelly']['dias_para_duplicar'] or 'nunca (no hay ventaja)'), '',
         'Todas las reglas en el examen: %(reglas)d; ganan de media %(ganan_de_media)d; superan la t exigida %(superan_t_exigida)d.' % r['examen_todas'], '',
         '## Las 5 mejores en 2021–2024 y cómo les fue en el examen', '', '| Regla | Media 2021–24 | Media examen | Dobla examen | Quiebra examen | t examen |', '|---|---:|---:|---:|---:|---:|']
    for f in r['top5_eleccion']:
        a, b = f['eleccion_2021_2024'], f['examen_2_anos']
        L.append('| %s | %s %% | %s %% | %s %% | %s %% | %s |' % (f['regla'], a.get('media_por_apuesta_pct'), b.get('media_por_apuesta_pct'), b.get('dobla_pct'), b.get('quiebra_pct'), b.get('t')))
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', default='datos/panel.npz')
    ap.add_argument('--salida', default='/tmp/res/doblar')
    a = ap.parse_args()
    r = estudiar(cargar_panel(a.panel))
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'doblar.json'), 'w') as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(r))
    print(json.dumps({k: r[k] for k in ('periodos', 'reglas_probadas', 't_exigida', 'aprueba', 'kelly', 'examen_todas')}, ensure_ascii=False))
    print(json.dumps({'elegida': r['elegida']}, ensure_ascii=False)[:800])


if __name__ == '__main__':
    main()
