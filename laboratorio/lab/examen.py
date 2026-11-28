"""Examen de entrada de la zona de prácticas del servidor.

Cada idea con la que puede nacer un alumno (la gramática de prAzar y prMuta del servidor: señal, plazos, forma,
modo, lado, filtro y reajuste) se repasa en los últimos 2 años con las mismas reglas que el servidor (escala por
volatilidad, banda sin operar, funding) y el coste prudente del laboratorio (comisión + deslizamiento), en las 20
monedas cripto del servidor. Con cada riesgo (×1, ×2, ×3, ×5, ×10) aprueba si en esos 2 años no pierde dinero y
nunca se queda con menos de la mitad (que en la zona de prácticas es quiebra).

El servidor lo lee y, desde la v2.10.0, solo deja nacer alumnos que aprueban con su riesgo. Desde la v2.10.1 los
concentrados (todo en 1 o 3 monedas, como prConcentra del servidor: las de señal más fuerte, sin ajustar por
volatilidad) tienen su propio examen (clave ident_c1 o ident_c3).

Además estudia a fondo la línea «contra el funding» (1 día y 1 semana): repartida, en 3 monedas y en 1, con ×1, ×3,
×5 y ×10, en los 2 años y en toda la historia del laboratorio (resultado, caída, si habría quebrado, peor semana y
año a año).

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

from .comun import BANDA, COMISION, DESLIZAMIENTO, H, MONEDAS_SERVIDOR, SPANS
from .datos import cargar_panel
from .senales import bruto, memoria, objetivo
from .simular import correr, preparar, simular

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


def objetivo_concentrado(e, Mu, i_btc, conc, nombres=None):
    """prConcentra del servidor, normalizado a riesgo 1: de las monedas en las que la idea tiene posición, las `conc`
    de señal bruta más fuerte (en «sección», respecto a la media de esas), cada una con 1/conc del dinero y el signo de
    la idea. Sin ajuste por volatilidad."""
    base = objetivo(e, Mu, i_btc)
    x = bruto(e, Mu)
    mask = (base != 0) & np.isfinite(x)
    xx = np.where(mask, x, np.nan)
    if e['modo'] == 'seccion':
        with np.errstate(invalid='ignore'):
            media = np.nanmean(np.where(mask.any(axis=1)[:, None], xx, 0.0), axis=1)
        xx = xx - media[:, None]
    # como el servidor (v2.10.1): de más fuerte a más débil con la fuerza redondeada a 1e-10, y a igualdad, por nombre
    N = base.shape[1]
    nombres = nombres or [str(j) for j in range(N)]
    rango = np.argsort(np.argsort(np.array(nombres, dtype=object)))
    fuerza = np.where(mask, np.round(np.abs(np.nan_to_num(xx, nan=0.0)) * 1e10), -1.0)
    orden = np.lexsort((np.broadcast_to(rango, base.shape), -fuerza), axis=1)
    n = np.minimum(mask.sum(axis=1), conc)
    pos = np.zeros_like(base)
    filas = np.arange(base.shape[0])
    for k in range(conc):
        j = orden[:, k]
        ok = k < n
        pos[filas[ok], j[ok]] = np.sign(base[filas[ok], j[ok]]) / np.maximum(n[ok], 1)
    return pos


def ficha(r, t, ini, fin, R):
    """Resultado con riesgo R entre ini y fin: total, anual, caída máxima, si habría quebrado, peor semana, semanas
    positivas y año a año."""
    rr = np.log(np.maximum(1 + R * r[ini:fin], 1e-12))
    lg = np.cumsum(rr)
    if not len(lg):
        return {}
    pico = np.maximum.accumulate(np.concatenate([[0.0], lg]))[1:]
    sem = rr[: len(rr) // 168 * 168].reshape(-1, 168).sum(axis=1)
    anos = {}
    for k in range(ini, fin):
        a = dt.datetime.fromtimestamp(int(t[k]) / 1000, dt.timezone.utc).year
        anos[a] = anos.get(a, 0.0) + rr[k - ini]
    horas = fin - ini
    return {'rent_pct': round(math.expm1(lg[-1]) * 100, 1), 'rent_anual_pct': round(math.expm1(lg[-1] * 8760 / horas) * 100, 1),
            'caida_max_pct': round(float(1 - np.exp((lg - pico).min())) * 100, 1), 'quiebra': bool(lg.min() <= QUIEBRA),
            'minimo_pct': round(float(np.expm1(lg.min())) * 100, 1),
            'peor_semana_pct': round(float(np.expm1(sem.min())) * 100, 1) if len(sem) else None,
            'semanas_positivas_pct': round(float((sem > 0).mean()) * 100, 1) if len(sem) else None,
            'por_ano_pct': {str(a): round(math.expm1(v) * 100, 1) for a, v in sorted(anos.items())}}


def linea_contra_funding(Mu, Ru, Fu, hora, i_btc, coste, t, ini2, ini_todo, fin, nombres):
    """La línea del alumno «Contra el funding (1 día), todo en 1 moneda ×5» y sus vecinas."""
    filas = []
    for a in (24, 168):
        e = {'senal': 'funding_contra', 'a': a, 'forma': 'signo', 'modo': 'serie', 'lado': 'ambos', 'filtro': 'ninguno', 'cada': 1}
        for conc in (None, 3, 1):
            obj = objetivo(e, Mu, i_btc) if conc is None else objetivo_concentrado(e, Mu, i_btc, conc, nombres)
            r, g = simular(obj, Ru, Fu, hora, 1, coste, BANDA)
            for R in ((1, 3) if conc is None else (1, 3, 5, 10)):
                filas.append({'idea': 'Contra el funding (%s)' % ('1 día' if a == 24 else '1 semana'), 'concentracion': conc or 'repartida', 'riesgo': R,
                              'dos_anos': ficha(r, t, ini2, fin, R), 'toda_la_historia': ficha(r, t, ini_todo, fin, R),
                              'giro_anual': round(float(g[ini2:fin].sum()) * 8760 / max(fin - ini2, 1), 1)})
    return filas


def sugeridas(specs, tabla, Mu, Ru, Fu, hora, i_btc, coste, t, ini, ini_todo, fin, n=3, riesgo=5):
    """Las mejores variantes de la línea «contra el funding» que aprueban con ×5: para que la zona de prácticas las pruebe
    en vivo en el grupo arriesgado. Primero las que tampoco habrían quebrado en toda la historia; sin repetir la misma
    combinación de plazo, modo, lado, filtro y reajuste (la forma casi no cambia nada en esta señal)."""
    i = RIESGOS.index(riesgo)
    cands = []
    for e in specs:
        if e['senal'] != 'funding_contra':
            continue
        v = tabla.get(ident(e))
        if v and (v[0] >> i) & 1:
            cands.append((v[1 + i], e))
    cands.sort(key=lambda x: -x[0])
    vistas, out = set(), []
    for _, e in cands:
        clave = (e['a'], e['modo'], e['lado'], e['filtro'], e['cada'])
        if clave in vistas:
            continue
        vistas.add(clave)
        r, _, _ = correr(e, Mu, Ru, Fu, hora, i_btc, coste)
        dos, todo = ficha(r, t, ini, fin, riesgo), ficha(r, t, ini_todo, fin, riesgo)
        out.append({'ident': ident(e), 'spec': {k: e[k] for k in ('senal', 'a', 'b', 'forma', 'k', 'modo', 'lado', 'filtro', 'cada') if k in e},
                    'riesgo': riesgo, 'conc': None, 'dos_anos': dos, 'toda_la_historia': todo,
                    'motivo': 'Línea contra el funding (la pidió Catalina): variante repartida que aprueba con ×%d' % riesgo})
        if len(out) >= 3 * n:
            break
    out.sort(key=lambda x: (x['toda_la_historia'].get('quiebra', True), -x['dos_anos'].get('rent_pct', -100)))
    return out[:n]


def examinar(panel, dias=730, limite=0, con_concentrados=True):
    M = memoria(panel)
    R, Fsig, hora = preparar(panel)
    monedas = panel['monedas']
    cols = [monedas.index(m) for m in MONEDAS_SERVIDOR if m in monedas]
    if 'BTC' not in [monedas[c] for c in cols]:
        raise SystemExit('Falta BTC en el panel')
    Mu = {'lp': M['lp'][:, cols], 'ema': {s: v[:, cols] for s, v in M['ema'].items()}, 'sig': M['sig'][:, cols],
          'fe24': M['fe24'][:, cols], 'fe168': M['fe168'][:, cols], 'lista': M['lista'][:, cols]}
    Ru, Fu = R[:, cols], Fsig[:, cols]
    nombres = [monedas[c] for c in cols]
    i_btc = nombres.index('BTC')
    t = panel['t']
    fin = len(t) - 1  # la última hora no tiene la siguiente
    ini = int(np.searchsorted(t, t[fin] - dias * 24 * H))
    coste = COMISION + DESLIZAMIENTO
    specs = gramatica()
    if limite:
        specs = specs[:limite]
    tabla, aprueban, aprueban_c = {}, [0] * len(RIESGOS), [0] * len(RIESGOS)
    for e in specs:
        r, _, _ = correr(e, Mu, Ru, Fu, hora, i_btc, coste)
        mask, rents = nota(r[ini:fin])
        tabla[ident(e)] = [mask] + rents
        for i in range(len(RIESGOS)):
            aprueban[i] += (mask >> i) & 1
        if con_concentrados:
            for conc in (1, 3):
                rc, _ = simular(objetivo_concentrado(e, Mu, i_btc, conc, nombres), Ru, Fu, hora, int(e["cada"]), coste, BANDA)
                mc, rentc = nota(rc[ini:fin])
                tabla[ident(e) + '_c%d' % conc] = [mc] + rentc
                for i in range(len(RIESGOS)):
                    aprueban_c[i] += (mc >> i) & 1
    lista = Mu['lista'].sum(axis=1)
    ini_todo = int(np.argmax(lista >= 5))
    linea = linea_contra_funding(Mu, Ru, Fu, hora, i_btc, coste, t, ini, ini_todo, fin, nombres)
    sug = sugeridas(specs, tabla, Mu, Ru, Fu, hora, i_btc, coste, t, ini, ini_todo, fin)
    f = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%d')
    return {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'version': 1,
        'aviso': 'Investigación en papel: resultados pasados con costes estimados; aprobar no garantiza nada.',
        'regla': 'Aprueba con un riesgo si en la ventana no pierde dinero y nunca baja de la mitad (quiebra).',
        'ventana': {'desde': f(int(t[ini])), 'hasta': f(int(t[fin])), 'dias': dias, 'horas': int(fin - ini)},
        'universo': [monedas[c] for c in cols], 'coste_por_giro_pct': round(coste * 100, 4), 'riesgos': RIESGOS,
        'formato': 'ident: [máscara de riesgos aprobados (bit i = riesgos[i]), resultado % con ×1, ×2, ×3, ×5, ×10]',
        'resumen': {'ideas': len(tabla), 'aprueban': {('x%d' % R): n for R, n in zip(RIESGOS, aprueban)},
                    'aprueban_concentradas': {('x%d' % R): n for R, n in zip(RIESGOS, aprueban_c)}},
        'linea_contra_funding': {'toda_la_historia_desde': f(int(t[ini_todo])), 'filas': linea,
                                 'explicacion': 'Contra el funding: vende donde los compradores pagan mucho y compra donde pagan los vendedores (media de 1 día o de 1 semana). Concentrada: todo en las 1 o 3 monedas con el funding más extremo, sin ajustar por volatilidad, como los alumnos arriesgados.'},
        'sugeridas': sug,
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
