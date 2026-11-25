"""Memoria del mercado (idéntica a la del servidor) y las estrategias candidatas.

Cada estrategia se escribe solo con lo que el servidor ya recuerda de cada moneda (medias exponenciales del
log-precio, volatilidad horaria y funding), para que las ganadoras puedan competir en vivo tal cual.
"""
import itertools
import math

import numpy as np
from numba import njit

from .comun import HORAS_MIN, SPAN_VOL, SPANS, VOL_OBJ_H


@njit(cache=True)
def _memoria(P, Finfo, spans):
    """Recorre las horas como apPaso: EMAs del log-precio con alfa ajustada a los huecos, varianza EMA (2/169)
    del rendimiento horario y EMAs del funding (24 h y 168 h). Devuelve arrays [T, N] (NaN si aún no hay dato)."""
    T, N = P.shape
    S = spans.shape[0]
    EMA = np.full((S, T, N), np.nan)
    V2 = np.full((T, N), np.nan)
    FE24 = np.full((T, N), np.nan)
    FE168 = np.full((T, N), np.nan)
    NH = np.zeros((T, N), dtype=np.int64)
    a_v = 2.0 / (SPAN_VOL + 1)
    for j in range(N):
        lp_prev = np.nan
        t_prev = -1
        ema = np.full(S, np.nan)
        v2 = np.nan
        n = 0
        nf = 0
        fe24 = np.nan
        fe168 = np.nan
        tf_prev = -1
        for t in range(T):
            p = P[t, j]
            if p > 0:
                horas = 1 if t_prev < 0 else t - t_prev
                lp = math.log(p)
                if t_prev >= 0:
                    lr = (lp - lp_prev) / math.sqrt(horas)
                    v2 = lr * lr if np.isnan(v2) else v2 + (1.0 - (1.0 - a_v) ** horas) * (lr * lr - v2)
                for s in range(S):
                    a = 1.0 - (1.0 - 2.0 / (spans[s] + 1.0)) ** horas
                    ema[s] = lp if np.isnan(ema[s]) else ema[s] + a * (lp - ema[s])
                lp_prev = lp
                n += horas if t_prev >= 0 else 1
                t_prev = t
                f = Finfo[t, j]
                if not np.isnan(f):
                    hf = 1 if tf_prev < 0 else t - tf_prev
                    nf += hf
                    if nf <= hf:
                        fe24 = f
                        fe168 = f
                    else:
                        fe24 = fe24 + (1.0 - (1.0 - 2.0 / 25.0) ** hf) * (f - fe24)
                        fe168 = fe168 + (1.0 - (1.0 - 2.0 / 169.0) ** hf) * (f - fe168)
                    tf_prev = t
            if t_prev >= 0 and t - t_prev <= 0:
                for s in range(S):
                    EMA[s, t, j] = ema[s]
                V2[t, j] = v2
                FE24[t, j] = fe24
                FE168[t, j] = fe168
                NH[t, j] = n
    return EMA, V2, FE24, FE168, NH


def memoria(panel):
    P = panel['P']
    Finfo = panel['Finfo']
    EMA, V2, FE24, FE168, NH = _memoria(P, Finfo, np.array(SPANS, dtype=np.float64))
    lp = np.log(np.where(P > 0, P, np.nan))
    sig = np.sqrt(V2)
    lista = (NH >= HORAS_MIN) & (P > 0) & (sig > 0)
    ema = {s: EMA[k] for k, s in enumerate(SPANS)}
    return {'lp': lp, 'ema': ema, 'sig': sig, 'fe24': FE24, 'fe168': FE168, 'lista': lista}


# ---------- el espacio de estrategias ----------
# senal: cruce(a,b) | impulso(a) | rebote(a) | funding_contra(s) | funding_sigue(s)
# forma: signo | continua(k)   ·   modo: serie | seccion   ·   lado: ambos | largos | cortos
# filtro: ninguno | btc_alcista | btc_bajista   ·   cada: 1 | 24 (horas entre reajustes)

def senales_base():
    out = []
    for a, b in itertools.combinations(SPANS, 2):
        out.append({'senal': 'cruce', 'a': a, 'b': b})
    for a in SPANS:
        out.append({'senal': 'impulso', 'a': a})
    for a in SPANS:
        out.append({'senal': 'rebote', 'a': a})
    for s in (24, 168):
        out.append({'senal': 'funding_contra', 'a': s})
        out.append({'senal': 'funding_sigue', 'a': s})
    out.append({'senal': 'tendencia_mixta', 'a': 12, 'b': 720})
    return out


PARES_MIXTA = ((12, 72), (24, 168), (72, 336), (168, 720))


FORMAS = [{'forma': 'signo'}, {'forma': 'continua', 'k': 0.5}, {'forma': 'continua', 'k': 2.0}]


def rejilla():
    """Todas las estrategias candidatas, en un orden fijo (el id es estable entre ejecuciones)."""
    out = []
    for sb in senales_base():
        for fo in FORMAS:
            for cada in (1, 24):
                for lado in ('ambos', 'largos', 'cortos'):
                    for filtro in ('ninguno', 'btc_alcista', 'btc_bajista'):
                        out.append(dict(sb, **fo, modo='serie', lado=lado, filtro=filtro, cada=cada))
                for filtro in ('ninguno', 'btc_alcista', 'btc_bajista'):
                    out.append(dict(sb, **fo, modo='seccion', lado='ambos', filtro=filtro, cada=cada))
    for i, e in enumerate(out):
        e['id'] = 'lab_' + ident(e)
    return out


def ident(e):
    partes = [e['senal'], str(e['a'])]
    if 'b' in e:
        partes.append(str(e['b']))
    partes.append('s' if e['forma'] == 'signo' else 'c%g' % e['k'])
    partes += [e['modo'][:3], e['lado'][:3], {'ninguno': 'nf', 'btc_alcista': 'ba', 'btc_bajista': 'bb'}[e['filtro']], 'h%d' % e['cada']]
    return '_'.join(partes)


def nombre(e):
    dur = lambda h: {12: '12 h', 24: '1 día', 72: '3 días', 168: '1 semana', 336: '2 semanas', 720: '1 mes'}[h]
    if e['senal'] == 'tendencia_mixta':
        base = 'Tendencia mixta (4 horizontes, de 12 h a 1 mes)'
    elif e['senal'] == 'cruce':
        base = 'Tendencia %s / %s' % (dur(e['a']), dur(e['b']))
    elif e['senal'] == 'impulso':
        base = 'Impulso de %s' % dur(e['a'])
    elif e['senal'] == 'rebote':
        base = 'Rebote de %s' % dur(e['a'])
    elif e['senal'] == 'funding_contra':
        base = 'Contra el funding (%s)' % dur(e['a'])
    else:
        base = 'A favor del funding (%s)' % dur(e['a'])
    extra = []
    if e['modo'] == 'seccion':
        extra.append('relativa entre monedas')
    if e['lado'] != 'ambos':
        extra.append('solo ' + ('compras' if e['lado'] == 'largos' else 'ventas'))
    if e['filtro'] != 'ninguno':
        extra.append('si BTC sube' if e['filtro'] == 'btc_alcista' else 'si BTC baja')
    if e['forma'] != 'signo':
        extra.append('graduada')
    if e['cada'] == 24:
        extra.append('reajuste diario')
    return base + (' (' + ', '.join(extra) + ')' if extra else '')


def bruto(e, M):
    """Señal bruta x[t, j] antes de la forma; la escala es aproximadamente la de una desviación típica."""
    sig = M['sig']
    if e['senal'] == 'tendencia_mixta':
        # media de los signos de cuatro cruces: de -1 (todos bajistas) a +1 (todos alcistas)
        x = sum(np.sign(M['ema'][a] - M['ema'][b]) for a, b in PARES_MIXTA) / len(PARES_MIXTA)
        return np.where(sig > 0, x, np.nan)
    if e['senal'] == 'cruce':
        return (M['ema'][e['a']] - M['ema'][e['b']]) / (sig * math.sqrt(e['b']))
    if e['senal'] == 'impulso':
        return (M['lp'] - M['ema'][e['a']]) / (sig * math.sqrt(e['a']))
    if e['senal'] == 'rebote':
        return -(M['lp'] - M['ema'][e['a']]) / (sig * math.sqrt(e['a']))
    fe = M['fe24'] if e['a'] == 24 else M['fe168']
    x = fe * 8760 / 0.3  # 30 % anual de funding ~ 1
    return -x if e['senal'] == 'funding_contra' else x


def objetivo(e, M, i_btc):
    """Posición objetivo [T, N] por moneda, como fracción del dinero, igual que haría el servidor:
    señal en [-1, 1] × min(1, vol_objetivo / vol) / número de monedas en la lista."""
    x = bruto(e, M)
    lista = M['lista'] & np.isfinite(x)
    x = np.where(lista, x, np.nan)
    n = lista.sum(axis=1).astype(np.float64)
    if e['modo'] == 'seccion':
        cuenta = lista.sum(axis=1)
        media = np.where(cuenta > 0, np.where(lista, x, 0.0).sum(axis=1) / np.maximum(cuenta, 1), 0.0)
        x = x - media[:, None]
        n = np.where(n >= 4, n, 0)  # relativa: al menos 4 monedas
    if e['forma'] == 'signo':
        s = np.sign(x)
    else:
        s = np.clip(x / e['k'], -1.0, 1.0)
    if e['lado'] == 'largos':
        s = np.maximum(s, 0)
    elif e['lado'] == 'cortos':
        s = np.minimum(s, 0)
    if e['filtro'] != 'ninguno':
        b = M['ema'][168][:, i_btc] - M['ema'][720][:, i_btc]
        alcista = b > 0
        activo = alcista if e['filtro'] == 'btc_alcista' else ~alcista
        activo &= np.isfinite(b) & M['lista'][:, i_btc]
        s = s * activo[:, None]
    esc = np.minimum(1.0, VOL_OBJ_H / M['sig'])
    with np.errstate(invalid='ignore', divide='ignore'):
        pos = s * esc / n[:, None]
    pos = np.where(lista & (n[:, None] > 0), pos, 0.0)
    return np.nan_to_num(pos, nan=0.0, posinf=0.0, neginf=0.0)
