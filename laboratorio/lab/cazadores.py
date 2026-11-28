"""Examen con la historia de los cazadores de funding del servidor (v2.9.1) y del cazador entre exchanges.

Repasa hora a hora, con las mismas reglas que el servidor (czPaso en servidor/worker.js), los 8 cazadores:
  - 5 cubiertos: venden el perpetuo y compran el contado; cobran 2/3 del funding; deciden con la media de 24 h
    (el de pago constante, con la de 3 días); entrar y salir cuesta como el cobro del funding del servidor.
  - 3 sin cubrir: van contra el exceso con el funding de la hora; dependen del precio.
y 3 cazadores entre exchanges (nuevos, aún no están en el servidor): cuando la media de 24 h de la diferencia de
funding entre Hyperliquid y Kraken Futures pasa de un umbral, venden donde se cobra más y compran donde se paga
menos. Sin riesgo de precio salvo la diferencia entre los dos precios, y sin necesitar contado.

Sin mirar al futuro: cada hora se decide con el funding que acaba de pagarse y se cobra el de la hora siguiente.
Datos públicos, sin claves. Hyperliquid: universo con las monedas retiradas (menos sesgo de supervivencia), velas
diarias (volumen), velas de 1 h recientes (unas 5000, lo que da su API) y funding horario (con caché entre
ejecuciones). Kraken Futures: instrumentos, funding histórico y velas de 1 h.

Uso: python -m lab.cazadores --salida /tmp/cz [--horas-funding 8760] [--horas-precio 5000] [--cache datos/cazadores]
"""
import argparse
import datetime as dt
import json
import math
import os
import time

import numpy as np

from .comun import H
from .datos import _http, hl

KF = 'https://futures.kraken.com'

# --- reglas: copia exacta de CZ y CZ_CAZADORES del servidor (v2.9.1) -------------------------------------------
E24 = 2 / 25
E72 = 2 / 73
VOL_SIGUE = 0.5
ETA = 10
REPARTO = 0.001
PARTE_CARRY = 2 / 3
COSTE_CARRY = 0.0011
COMISION = 0.00045
CAZADORES = [
    {'id': 'cz_cob_20', 'nombre': 'Cubierto: las 5 que más pagan (media de 24 h desde 20 % al año)', 'modo': 'cubierto', 'entra': 0.2, 'sale': 0.1, 'k': 5, 'vol': 1e6, 'media': 24},
    {'id': 'cz_cob_50', 'nombre': 'Cubierto: las 3 que más pagan (media de 24 h desde 50 % al año)', 'modo': 'cubierto', 'entra': 0.5, 'sale': 0.2, 'k': 3, 'vol': 1e6, 'media': 24},
    {'id': 'cz_cob_100', 'nombre': 'Cubierto: solo extremos (media de 24 h desde 100 % al año)', 'modo': 'cubierto', 'entra': 1.0, 'sale': 0.4, 'k': 3, 'vol': 1e6, 'media': 24},
    {'id': 'cz_cob_liq', 'nombre': 'Cubierto: las 10 que más pagan entre las muy líquidas (más de 5 M$ al día; media de 24 h)', 'modo': 'cubierto', 'entra': 0.1, 'sale': 0.05, 'k': 10, 'vol': 5e6, 'media': 24},
    {'id': 'cz_cob_const', 'nombre': 'Cubierto: solo si pagan de forma constante (media de 3 días desde 30 %)', 'modo': 'cubierto', 'entra': 0.3, 'sale': 0.15, 'k': 5, 'vol': 1e6, 'media': 72},
    {'id': 'cz_contra_compra', 'nombre': 'Sin cubrir: vende cuando los compradores pagan demasiado (desde 100 % al año)', 'modo': 'contra', 'lado': 'largos', 'entra': 1.0, 'sale': 0.3, 'k': 3, 'vol': 1e6},
    {'id': 'cz_contra_venta', 'nombre': 'Sin cubrir: compra cuando los vendedores pagan demasiado (desde −50 % al año)', 'modo': 'contra', 'lado': 'cortos', 'entra': 0.5, 'sale': 0.15, 'k': 3, 'vol': 1e6},
    {'id': 'cz_contra_ambos', 'nombre': 'Sin cubrir: contra los excesos de los dos lados (desde 75 % al año)', 'modo': 'contra', 'lado': 'ambos', 'entra': 0.75, 'sale': 0.25, 'k': 5, 'vol': 1e6},
]
# --- entre exchanges (propuesta) -----------------------------------------------------------------------------------
PARTE_ENTRE = 2 / 3            # cada pata a ~1,33x: dos tercios del dinero en cada lado sin riesgo de liquidación cercano
COSTE_LADO = 0.00045 + 0.0005 + 2 * 0.00025  # por unidad de pareja y por sentido: toma en Hyperliquid y en Kraken + diferencial
VOL_KRAKEN = 5e5               # volumen mínimo en Kraken (24 h) para entrar
ENTRE = [
    {'id': 'cz_entre_20', 'nombre': 'Entre exchanges: las 5 con más diferencia (media de 24 h desde 20 % al año)', 'entra': 0.2, 'sale': 0.1, 'k': 5, 'vol': 1e6},
    {'id': 'cz_entre_50', 'nombre': 'Entre exchanges: las 3 con más diferencia (media de 24 h desde 50 % al año)', 'entra': 0.5, 'sale': 0.2, 'k': 3, 'vol': 1e6},
    {'id': 'cz_entre_100', 'nombre': 'Entre exchanges: solo diferencias extremas (media de 24 h desde 100 % al año)', 'entra': 1.0, 'sale': 0.4, 'k': 3, 'vol': 1e6},
]


def stats():
    return {'n': 0, 's1': 0.0, 's2': 0.0, 'log': 0.0, 'maxLog': 0.0, 'dd': 0.0}


def suma(st, r):
    st['n'] += 1
    st['s1'] += r
    st['s2'] += r * r
    st['log'] += math.log(1 + max(r, -0.99))
    if st['log'] > st['maxLog']:
        st['maxLog'] = st['log']
    dd = 1 - math.exp(st['log'] - st['maxLog'])
    if dd > st['dd']:
        st['dd'] = dd


def _signo(x):
    return (x > 0) - (x < 0)


def nuevo(t, reglas=None):
    reglas = reglas or CAZADORES
    return {'creado': t, 't': None, 'px': {}, 'f': {}, 'e24': {}, 'e72': {}, 'n': {},
            'cz': {c['id']: {'pos': {}, 'st': stats(), 'coste': 0.0, 'tUlt': None, 'costes': 0.0, 'giro': 0.0, 'horasDentro': 0} for c in reglas},
            'eq': {'lw': {}, 'st': stats()}}


def anual(C, c, m, M):
    """czAnual del servidor: el funding anual que mira cada cazador, o None si aún no lo sabe."""
    if c.get('media') == 72:
        return C['e72'][m] * 8760 if C['n'].get(m, 0) >= 36 and C['e72'].get(m) is not None else None
    if c.get('media'):
        return C['e24'][m] * 8760 if C['n'].get(m, 0) >= 12 and C['e24'].get(m) is not None else None
    return M[m]['f'] * 8760


def elige(C, c, M, pos0):
    """czElige del servidor."""
    def dentro(m, ya=False):
        fa = anual(C, c, m, M)
        if fa is None or M[m]['vol'] < c['vol'] * (VOL_SIGUE if ya else 1):
            return 0
        if c['modo'] == 'cubierto' or c.get('lado') == 'largos':
            return 2 if fa >= c['entra'] else 1 if fa >= c['sale'] else 0
        if c.get('lado') == 'cortos':
            return 2 if fa <= -c['entra'] else 1 if fa <= -c['sale'] else 0
        return 2 if abs(fa) >= c['entra'] else 1 if abs(fa) >= c['sale'] else 0

    def lado(m):
        return 1 if c['modo'] == 'cubierto' else -_signo(anual(C, c, m, M))

    siguen = [m for m in pos0 if m in M and dentro(m, True) >= 1 and (c['modo'] == 'cubierto' or _signo(pos0[m]) == lado(m))]
    nuevos = [m for m in M if m not in siguen and dentro(m) == 2]
    nuevos.sort(key=lambda m: (-abs(anual(C, c, m, M)), m))
    siguen.sort(key=lambda m: -abs(anual(C, c, m, M)))
    elegidos = (siguen[: c['k']] + nuevos)[: c['k']]
    return {m: lado(m) / c['k'] for m in elegidos}


def giro(a, b):
    return sum(abs(a.get(m, 0) - b.get(m, 0)) for m in set(a) | set(b))


def pesos(C, reglas):
    ids = [c['id'] for c in reglas]
    s = sum(math.exp(C['eq']['lw'].get(i, 0)) for i in ids)
    return {i: math.exp(C['eq']['lw'].get(i, 0)) / s for i in ids}


def paso(C, M, t, reglas=None, cobro=None):
    """czPaso del servidor. M: {mercado: {'px', 'f', 'vol'}} de esta hora. cobro: {mercado: funding horario que paga
    la hora que acaba}; si no se da, como el servidor, el que se vio al decidir (C['f'])."""
    reglas = reglas or CAZADORES
    horas = 1 if C['t'] is None else max(1, math.floor((t - C['t']) / H + 0.5))
    w0, r = pesos(C, reglas), {}
    rEq, alguno = 0.0, False
    for c in reglas:
        X = C['cz'][c['id']]
        if X['tUlt'] is None:
            continue
        x = 0.0
        for m, q in X['pos'].items():
            f = (cobro[m] if cobro is not None and m in cobro else C['f'].get(m, 0)) * horas
            a, b = C['px'].get(m), (M[m]['px'] if m in M else None)
            if c['modo'] == 'cubierto':
                x += q * PARTE_CARRY * f
            elif a and b and a > 0 and b > 0:
                x += q * (b / a - 1 - f)
        x -= X['coste']
        X['coste'] = 0.0
        suma(X['st'], max(-0.99, x))
        if X['pos']:
            X['horasDentro'] += 1
        r[c['id']] = x
        rEq += w0[c['id']] * x
        alguno = True
    if alguno:
        suma(C['eq']['st'], max(-0.99, rEq))
    lw = C['eq']['lw']
    for c in reglas:
        if c['id'] in r:
            lw[c['id']] = lw.get(c['id'], 0) + ETA * math.log(1 + max(r[c['id']], -0.99))
    w1, N = pesos(C, reglas), len(reglas)
    for c in reglas:
        lw[c['id']] = math.log((1 - REPARTO) * w1[c['id']] + REPARTO / N)
    mx = max(lw[c['id']] for c in reglas)
    for c in reglas:
        lw[c['id']] -= mx
    for m, d in M.items():
        h = horas if C['n'].get(m) else 1
        C['e24'][m] = d['f'] if C['e24'].get(m) is None else C['e24'][m] + (1 - (1 - E24) ** h) * (d['f'] - C['e24'][m])
        C['e72'][m] = d['f'] if C['e72'].get(m) is None else C['e72'][m] + (1 - (1 - E72) ** h) * (d['f'] - C['e72'][m])
        C['n'][m] = C['n'].get(m, 0) + 1
    for m in [m for m in C['e24'] if m not in M]:
        C['e24'].pop(m, None)
        C['e72'].pop(m, None)
        C['n'].pop(m, None)
    usados = set()
    for c in reglas:
        X = C['cz'][c['id']]
        pos = elige(C, c, M, X['pos'])
        g = giro(pos, X['pos'])
        X['coste'] = g * PARTE_CARRY * COSTE_CARRY / 2 if c['modo'] == 'cubierto' else g * COMISION
        X['costes'] += X['coste']
        X['giro'] += g
        X['pos'] = pos
        X['tUlt'] = t
        usados |= set(pos)
    C['px'] = {m: M[m]['px'] for m in usados}
    C['f'] = {m: M[m]['f'] for m in usados}
    C['t'] = t
    return C


# --- entre exchanges ----------------------------------------------------------------------------------------------
def nuevo_entre(t):
    return {'t': None, 'e24': {}, 'n': {}, 'ph': {}, 'pk': {}, 'fh': {}, 'fk': {},
            'cz': {c['id']: {'pos': {}, 'st': stats(), 'coste': 0.0, 'costes': 0.0, 'giro': 0.0, 'horasDentro': 0, 'tUlt': None} for c in ENTRE},
            'eq': {'lw': {}, 'st': stats()}}


def paso_entre(C, M, t, cobro=None):
    """M: {moneda: {'ph', 'pk', 'fh', 'fk', 'volh', 'volk'}} (precio y funding horario en Hyperliquid y en Kraken).
    Posición s/k con s = +1 (vende en Hyperliquid, compra en Kraken) si Hyperliquid paga más, −1 al revés.
    Resultado de la hora: s/k · PARTE · [(fH − fK) + (rK − rH)] menos el coste de las dos patas."""
    horas = 1 if C['t'] is None else max(1, math.floor((t - C['t']) / H + 0.5))
    w0, r = pesos(C, ENTRE), {}
    rEq, alguno = 0.0, False
    for c in ENTRE:
        X = C['cz'][c['id']]
        if X['tUlt'] is None:
            continue
        x = 0.0
        for m, q in X['pos'].items():
            fh, fk = (cobro[m] if cobro is not None and m in cobro else (C['fh'].get(m, 0), C['fk'].get(m, 0)))
            a_h, a_k = C['ph'].get(m), C['pk'].get(m)
            b_h, b_k = (M[m]['ph'], M[m]['pk']) if m in M else (None, None)
            rh = b_h / a_h - 1 if a_h and b_h else 0.0
            rk = b_k / a_k - 1 if a_k and b_k else 0.0
            x += q * PARTE_ENTRE * ((fh - fk) * horas + rk - rh)
        x -= X['coste']
        X['coste'] = 0.0
        suma(X['st'], max(-0.99, x))
        if X['pos']:
            X['horasDentro'] += 1
        r[c['id']] = x
        rEq += w0[c['id']] * x
        alguno = True
    if alguno:
        suma(C['eq']['st'], max(-0.99, rEq))
    lw = C['eq']['lw']
    for c in ENTRE:
        if c['id'] in r:
            lw[c['id']] = lw.get(c['id'], 0) + ETA * math.log(1 + max(r[c['id']], -0.99))
    w1, N = pesos(C, ENTRE), len(ENTRE)
    for c in ENTRE:
        lw[c['id']] = math.log((1 - REPARTO) * w1[c['id']] + REPARTO / N)
    mx = max(lw[c['id']] for c in ENTRE)
    for c in ENTRE:
        lw[c['id']] -= mx
    for m, d in M.items():
        h = horas if C['n'].get(m) else 1
        dif = d['fh'] - d['fk']
        C['e24'][m] = dif if C['e24'].get(m) is None else C['e24'][m] + (1 - (1 - E24) ** h) * (dif - C['e24'][m])
        C['n'][m] = C['n'].get(m, 0) + 1
    for m in [m for m in C['e24'] if m not in M]:
        C['e24'].pop(m, None)
        C['n'].pop(m, None)
    usados = set()
    for c in ENTRE:
        X = C['cz'][c['id']]

        def da(m):
            return C['e24'][m] * 8760 if C['n'].get(m, 0) >= 12 else None

        def dentro(m, ya=False):
            x = da(m)
            k = VOL_SIGUE if ya else 1
            if x is None or M[m]['volh'] < c['vol'] * k or M[m]['volk'] < VOL_KRAKEN * k:
                return 0
            return 2 if abs(x) >= c['entra'] else 1 if abs(x) >= c['sale'] else 0
        siguen = [m for m in X['pos'] if m in M and dentro(m, True) >= 1 and _signo(X['pos'][m]) == _signo(da(m))]
        nuevos = sorted([m for m in M if m not in siguen and dentro(m) == 2], key=lambda m: (-abs(da(m)), m))
        siguen.sort(key=lambda m: -abs(da(m)))
        pos = {m: _signo(da(m)) / c['k'] for m in (siguen[: c['k']] + nuevos)[: c['k']]}
        g = giro(pos, X['pos'])
        X['coste'] = g * PARTE_ENTRE * COSTE_LADO
        X['costes'] += X['coste']
        X['giro'] += g
        X['pos'] = pos
        X['tUlt'] = t
        usados |= set(pos)
    C['ph'] = {m: M[m]['ph'] for m in usados}
    C['pk'] = {m: M[m]['pk'] for m in usados}
    C['fh'] = {m: M[m]['fh'] for m in usados}
    C['fk'] = {m: M[m]['fk'] for m in usados}
    C['t'] = t
    return C


# --- métricas -----------------------------------------------------------------------------------------------------
def medir(st, horas_total, serie=None):
    n = st['n']
    if not n:
        return {'horas': 0}
    m = st['s1'] / n
    sd = math.sqrt(max(st['s2'] / n - m * m, 0))
    sr = m / sd if sd > 0 else 0.0
    out = {'horas': n, 'rent_pct': round((math.exp(st['log']) - 1) * 100, 3),
           'rent_anual_pct': round((math.exp(st['log'] * 8760 / n) - 1) * 100, 2),
           'sharpe_anual': round(sr * math.sqrt(8760), 2), 't': round(sr * math.sqrt(n), 2),
           'caida_max_pct': round(st['dd'] * 100, 2)}
    if serie is not None and len(serie) >= 24 * 14:
        s = np.asarray(serie)
        sem = s[: len(s) // 168 * 168].reshape(-1, 168).sum(axis=1)
        out['semanas_positivas_pct'] = round(float((sem > 0).mean() * 100), 1)
        mitad = len(s) // 2
        out['primera_mitad_pct'] = round(float(np.expm1(np.log1p(np.maximum(s[:mitad], -0.99)).sum()) * 100), 3)
        out['segunda_mitad_pct'] = round(float(np.expm1(np.log1p(np.maximum(s[mitad:], -0.99)).sum()) * 100), 3)
    return out


def repasar(horas, reglas=None, cobros=None, entre=False):
    """horas: lista de (t, M) en orden. cobros: lista paralela con el funding que paga la hora siguiente (o None).
    Devuelve el estado final y la serie de resultados por hora de cada cazador y del equipo."""
    reglas = reglas or (ENTRE if entre else CAZADORES)
    C = nuevo_entre(horas[0][0]) if entre else nuevo(horas[0][0], reglas)
    series = {c['id']: [] for c in reglas}
    series['equipo'] = []
    previo = {c['id']: 0.0 for c in reglas}
    previo['equipo'] = 0.0
    for i, (t, M) in enumerate(horas):
        cobro = cobros[i - 1] if cobros is not None and i > 0 else None
        if entre:
            paso_entre(C, M, t, cobro)
        else:
            paso(C, M, t, reglas, cobro)
        for c in reglas:
            st = C['cz'][c['id']]['st']
            if st['n']:
                series[c['id']].append(math.expm1(st['log'] - previo[c['id']]))
                previo[c['id']] = st['log']
        if C['eq']['st']['n']:
            series['equipo'].append(math.expm1(C['eq']['st']['log'] - previo['equipo']))
            previo['equipo'] = C['eq']['st']['log']
    return C, series


def resumen(C, series, reglas, horas_total):
    filas = []
    for c in reglas:
        X = C['cz'][c['id']]
        f = {'id': c['id'], 'cazador': c['nombre'], 'modo': c.get('modo', 'entre exchanges')}
        f.update(medir(X['st'], horas_total, series[c['id']]))
        n = max(X['st']['n'], 1)
        f['horas_con_posicion_pct'] = round(X['horasDentro'] / n * 100, 1)
        f['costes_pct'] = round(X['costes'] * 100, 3)
        f['giro_anual'] = round(X['giro'] * 8760 / n, 1)
        filas.append(f)
    eq = medir(C['eq']['st'], horas_total, series['equipo'])
    return filas, eq


# --- datos ----------------------------------------------------------------------------------------------------------
def _get_kraken(url):
    estado, b = _http(url, intentos=4, timeout=60)
    time.sleep(0.25)
    if estado != 200 or not b:
        return None
    try:
        return json.loads(b)
    except ValueError:
        return None


def universo_hl():
    """Todos los perpetuos del dex principal, también los retirados."""
    j = hl({'type': 'meta'}, peso=20) or {}
    return [(u['name'], bool(u.get('isDelisted'))) for u in j.get('universe', [])]


def velas(coin, intervalo, desde, hasta):
    paso = H if intervalo == '1h' else 24 * H
    peso = 20 + max(1, (hasta - desde) // paso) // 60
    v = hl({'type': 'candleSnapshot', 'req': {'coin': coin, 'interval': intervalo, 'startTime': desde, 'endTime': hasta}}, peso=peso) or []
    return [(int(k['t']), float(k['c']), float(k['v']) * float(k['c'])) for k in v]


def funding_hl(coin, desde, hasta, cache=None):
    """Funding horario [(t, tasa)] de Hyperliquid con caché por moneda (solo pide lo que falta)."""
    ruta = os.path.join(cache, 'fh_' + coin.replace('/', '_') + '.json') if cache else None
    viejo = []
    if ruta and os.path.exists(ruta):
        try:
            with open(ruta) as f:
                viejo = [tuple(x) for x in json.load(f)]
        except (OSError, ValueError):
            viejo = []
    tiene = {t for t, _ in viejo}
    ini = desde
    if viejo:
        t0, t1 = min(tiene), max(tiene)
        ini = t1 + 1 if t0 <= desde else desde
    nuevas = []
    cur = ini
    for _ in range(60):
        if cur >= hasta:
            break
        f = hl({'type': 'fundingHistory', 'coin': coin, 'startTime': cur, 'endTime': hasta}, peso=45)
        if not f:
            break
        nuevas += [(int(round(int(x['time']) / H)) * H, float(x['fundingRate'])) for x in f]
        u = int(f[-1]['time'])
        if len(f) < 500 or u <= cur:
            break
        cur = u + 1
    todo = dict(viejo)
    todo.update(dict(nuevas))
    filas = sorted(todo.items())
    if ruta:
        os.makedirs(cache, exist_ok=True)
        with open(ruta, 'w') as f:
            json.dump(filas, f)
    return [(t, r) for t, r in filas if desde <= t <= hasta]


def base_hl(coin):
    if coin.startswith('k') and coin[1:].isupper():
        return coin[1:], 1000
    return coin, 1


def base_kraken(simbolo):
    if not simbolo.startswith('PF_') or not simbolo.endswith('USD'):
        return None
    b = simbolo[3:-3]
    mult = 1
    for mm in (1000000, 1000):
        if b.startswith(str(mm)) and len(b) > len(str(mm)):
            b, mult = b[len(str(mm)):], mm
            break
    return {'XBT': 'BTC', 'XDG': 'DOGE'}.get(b, b), mult


def kraken_perpetuos():
    ins = (_get_kraken(KF + '/derivatives/api/v3/instruments') or {}).get('instruments', [])
    out = {}
    for i in ins:
        s = i.get('symbol', '')
        b = base_kraken(s)
        if b and i.get('tradeable') is not False:
            out.setdefault(b[0], (s, b[1]))
    return out


def funding_kraken(simbolo):
    """Funding de Kraken por hora [(t, tasa horaria)]. Kraken publica la tasa relativa de cada periodo; el periodo se
    deduce de los datos (si fuera de 4 h, se reparte entre sus horas)."""
    j = _get_kraken('%s/derivatives/api/v3/historical-funding-rates?symbol=%s' % (KF, simbolo)) or {}
    filas = []
    for r in j.get('rates', []):
        try:
            t = int(dt.datetime.fromisoformat(r['timestamp'].replace('Z', '+00:00')).timestamp() * 1000)
            filas.append((t // H * H, float(r['relativeFundingRate'])))
        except (KeyError, TypeError, ValueError):
            continue
    if len(filas) < 3:
        return []
    filas.sort()
    inter = max(1, round(float(np.median(np.diff([t for t, _ in filas]))) / H))
    out = []
    for t, r in filas:
        for k in range(inter):
            out.append((t - k * H, r / inter))
    return sorted(set(out))


def velas_kraken(simbolo, desde_ms, hasta_ms):
    """Velas de 1 h de Kraken: {t_cierre: (cierre, volumen en USD)}."""
    out = {}
    desde, fin = desde_ms // 1000, hasta_ms // 1000
    for _ in range(20):
        j = _get_kraken('%s/api/charts/v1/trade/%s/1h?from=%d&to=%d' % (KF, simbolo, desde, fin))
        if not j or not j.get('candles'):
            break
        ult = desde
        for c in j['candles']:
            t = int(c['time'])
            t = t * 1000 if t < 10**11 else t
            px = float(c['close'])
            out[t + H] = (px, float(c.get('volume', 0) or 0) * px)
            ult = max(ult, t // 1000)
        if not j.get('more_candles') or ult <= desde:
            break
        desde = ult + 1
    return {t: v for t, v in out.items() if t <= hasta_ms}


def montar(horas_funding, horas_precio, cache, registro):
    """Descarga y monta las horas para los dos repasos. Devuelve (horas_fund, cobros_fund, horas_precio, cobros_precio,
    horas_entre, cobros_entre, info)."""
    fin = int(time.time() * 1000) // H * H - H
    ini_f = fin - horas_funding * H
    ini_p = fin - horas_precio * H
    uni = universo_hl()
    registro['universo'] = len(uni)
    registro['retiradas'] = sum(1 for _, d in uni if d)
    # 1) volumen diario de todas para saber cuáles llegaron alguna vez a 1 M$ al día en el periodo
    diario, candidatas = {}, []
    for coin, _ in uni:
        v = velas(coin, '1d', ini_f - 2 * 24 * H, fin)
        d = {t // (24 * H): vol for t, _, vol in v}
        diario[coin] = d
        if any(x >= 1e6 for x in d.values()):
            candidatas.append(coin)
    registro['con_volumen'] = len(candidatas)
    # 2) funding horario (con caché) de las candidatas
    fund = {}
    for coin in candidatas:
        fund[coin] = dict(funding_hl(coin, ini_f, fin + H, cache))
    # 3) velas de 1 h recientes de las candidatas (precio y volumen de 24 h)
    precio = {}
    for coin in candidatas:
        v = velas(coin, '1h', ini_p - 25 * H, fin)
        precio[coin] = {t + H: (c, vol) for t, c, vol in v}
    # horas para los cubiertos (solo funding y volumen diario del día anterior): todo el periodo de funding
    def vol_dia(coin, t):
        return diario[coin].get(t // (24 * H) - 1, 0.0)
    horas_f, cobros_f = [], []
    for t in range(ini_f, fin + H, H):
        M, cob = {}, {}
        for coin in candidatas:
            f = fund[coin].get(t)
            if f is None:
                continue
            p = precio[coin].get(t)
            M[coin] = {'px': p[0] if p else 1.0, 'f': f, 'vol': vol_dia(coin, t)}
            if (t + H) in fund[coin]:
                cob[coin] = fund[coin][t + H]
        horas_f.append((t, M))
        cobros_f.append(cob)
    # horas con precio (todos los cazadores): volumen de 24 h con las velas de 1 h
    horas_p, cobros_p = [], []
    acum = {coin: [] for coin in candidatas}
    for t in range(ini_p, fin + H, H):
        M, cob = {}, {}
        for coin in candidatas:
            p, f = precio[coin].get(t), fund[coin].get(t)
            if p is None or f is None:
                continue
            vols = [precio[coin].get(t - k * H, (0, 0))[1] for k in range(24)]
            M[coin] = {'px': p[0], 'f': f, 'vol': float(sum(vols))}
            if (t + H) in fund[coin]:
                cob[coin] = fund[coin][t + H]
        horas_p.append((t, M))
        cobros_p.append(cob)
    # 4) Kraken: las que están en los dos sitios
    kp = kraken_perpetuos()
    registro['kraken_perpetuos'] = len(kp)
    pares = []
    for coin in candidatas:
        b, mh = base_hl(coin)
        if b in kp:
            pares.append((coin, kp[b][0], mh, kp[b][1]))
    registro['en_los_dos'] = len(pares)
    fk, pk = {}, {}
    for coin, sym, _, _ in pares:
        fk[coin] = dict(funding_kraken(sym))
        pk[coin] = velas_kraken(sym, ini_p - 25 * H, fin)
    horas_e, cobros_e = [], []
    for t in range(ini_p, fin + H, H):
        M, cob = {}, {}
        for coin, _, _, _ in pares:
            ph, phk = precio[coin].get(t), pk[coin].get(t)
            fh_, fk_ = fund[coin].get(t), fk[coin].get(t)
            if None in (ph, phk, fh_, fk_):
                continue
            volh = float(sum(precio[coin].get(t - k * H, (0, 0))[1] for k in range(24)))
            volk = float(sum(pk[coin].get(t - k * H, (0, 0))[1] for k in range(24)))
            M[coin] = {'ph': ph[0], 'pk': phk[0], 'fh': fh_, 'fk': fk_, 'volh': volh, 'volk': volk}
            if (t + H) in fund[coin] and (t + H) in fk[coin]:
                cob[coin] = (fund[coin][t + H], fk[coin][t + H])
        horas_e.append((t, M))
        cobros_e.append(cob)
    info = {'desde_funding': ini_f, 'desde_precio': ini_p, 'hasta': fin}
    return horas_f, cobros_f, horas_p, cobros_p, horas_e, cobros_e, info


def fecha(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')


def estudiar(horas_f, cobros_f, horas_p, cobros_p, horas_e, cobros_e, info, registro):
    cub = [c for c in CAZADORES if c['modo'] == 'cubierto']
    out = {'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'version': 1,
           'aviso': 'Investigación en papel con datos pasados y costes estimados; no garantiza nada en el futuro.',
           'reglas': 'servidor v2.9.1 (cazadores) y propuesta entre exchanges', 'registro': registro, 'periodos': {}}
    if horas_f:
        C, s = repasar(horas_f, cub, cobros_f)
        filas, eq = resumen(C, s, cub, len(horas_f))
        out['periodos']['funding'] = {'desde': fecha(info['desde_funding']), 'hasta': fecha(info['hasta']), 'horas': len(horas_f),
                                      'explicacion': 'Los 5 cubiertos con todo el funding horario disponible (no dependen del precio).',
                                      'cazadores': filas, 'equipo_cubiertos': eq}
    if horas_p:
        C, s = repasar(horas_p, CAZADORES, cobros_p)
        filas, eq = resumen(C, s, CAZADORES, len(horas_p))
        out['periodos']['precio'] = {'desde': fecha(info['desde_precio']), 'hasta': fecha(info['hasta']), 'horas': len(horas_p),
                                     'explicacion': 'Los 8 cazadores, también los que dependen del precio, en las horas con velas de 1 h.',
                                     'cazadores': filas, 'equipo': eq}
    if horas_e:
        C, s = repasar(horas_e, cobros=cobros_e, entre=True)
        filas, eq = resumen(C, s, ENTRE, len(horas_e))
        out['periodos']['entre_exchanges'] = {'desde': fecha(info['desde_precio']), 'hasta': fecha(info['hasta']), 'horas': len(horas_e),
                                              'explicacion': 'Hyperliquid contra Kraken Futures en las monedas que están en los dos, con precio y funding de los dos.',
                                              'cazadores': filas, 'equipo': eq}
    return out


def informe(r):
    L = ['# Cazadores de funding: examen con la historia', '', '_' + r['aviso'] + '_', '',
         'Generado: %s. Reglas: %s.' % (r['generado'], r['reglas']), '']
    reg = r.get('registro', {})
    L.append('Universo de Hyperliquid: %s perpetuos (%s ya retirados); %s llegaron a 1 M$ al día. Kraken Futures: %s perpetuos; en los dos sitios: %s.' % (
        reg.get('universo'), reg.get('retiradas'), reg.get('con_volumen'), reg.get('kraken_perpetuos'), reg.get('en_los_dos')))
    for clave, p in r['periodos'].items():
        L += ['', '## ' + {'funding': 'Cubiertos, con todo el funding', 'precio': 'Los 8, con precio', 'entre_exchanges': 'Entre exchanges'}[clave],
              '%s → %s (%d horas). %s' % (p['desde'], p['hasta'], p['horas'], p['explicacion']), '',
              '| Cazador | Resultado | Al año | t | Caída máx. | Semanas + | Con posición | Costes |', '|---|---:|---:|---:|---:|---:|---:|---:|']
        for f in p['cazadores']:
            L.append('| %s | %s %% | %s %% | %s | %s %% | %s %% | %s %% | %s %% |' % (
                f['cazador'], f.get('rent_pct', '—'), f.get('rent_anual_pct', '—'), f.get('t', '—'), f.get('caida_max_pct', '—'),
                f.get('semanas_positivas_pct', '—'), f.get('horas_con_posicion_pct', '—'), f.get('costes_pct', '—')))
        eq = p.get('equipo') or p.get('equipo_cubiertos') or {}
        L.append('| **Equipo** | %s %% | %s %% | %s | %s %% | %s %% | | |' % (eq.get('rent_pct', '—'), eq.get('rent_anual_pct', '—'), eq.get('t', '—'),
                                                                        eq.get('caida_max_pct', '—'), eq.get('semanas_positivas_pct', '—')))
    L += ['', 'Sin mirar al futuro: se decide con el funding que acaba de pagarse y se cobra el de la hora siguiente. Volumen: el del día',
          'anterior (cubiertos con todo el funding) o el de las 24 h anteriores (con velas de 1 h). Supone que hay contado para cubrirse.',
          'Entre exchanges: toma en los dos sitios (0,045 % y 0,05 %) y 0,025 % de diferencial por pata, en cada entrada y salida.']
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='/tmp/cz')
    ap.add_argument('--horas-funding', type=int, default=8760)
    ap.add_argument('--horas-precio', type=int, default=5000)
    ap.add_argument('--cache', default=os.path.join('datos', 'cazadores'))
    a = ap.parse_args()
    t0 = time.time()
    registro = {}
    datos = montar(a.horas_funding, a.horas_precio, a.cache, registro)
    registro['segundos_descarga'] = round(time.time() - t0)
    r = estudiar(*datos, registro)
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'cazadores.json'), 'w') as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(r))
    print(json.dumps({k: {kk: (vv if kk != 'cazadores' else [(x['id'], x.get('rent_pct')) for x in vv]) for kk, vv in v.items()} for k, v in r['periodos'].items()}, ensure_ascii=False)[:4000])


if __name__ == '__main__':
    main()
