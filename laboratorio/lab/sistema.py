"""El sistema del servidor, entero, sobre años de historia: sus expertos de precio y funding (los de carteras y
flujo de órdenes no tienen historia) combinados hora a hora con los mismos pesos multiplicativos (Hedge).
Responde a: ¿cuánto habría ganado el sistema si hubiera funcionado desde 2021?"""
import math

import numpy as np
from numba import njit

from .comun import BANDA, VOL_OBJ_H
from .simular import simular

ETA = 10.0
REPARTO = 0.0002
PARTE_CARRY = 2.0 / 3.0
COSTE_CARRY = 0.0011


def _dir(id_, senal, a, b=None, forma='signo', k=None, lado='ambos'):
    e = {'id': id_, 'senal': senal, 'a': a, 'forma': forma, 'modo': 'serie', 'lado': lado, 'filtro': 'ninguno', 'cada': 1}
    if b is not None:
        e['b'] = b
    if k is not None:
        e['k'] = k
    return e


# Equivalencias exactas con AP_EXPERTOS del servidor (rev_24z: -clip((lp-ema24)/(2·σ·√12)) = rebote 24 graduado con k = √2)
EXPERTOS_PRECIO = [
    _dir('tend_12_72', 'cruce', 12, 72), _dir('tend_24_168', 'cruce', 24, 168), _dir('tend_72_336', 'cruce', 72, 336),
    _dir('tend_168_720', 'cruce', 168, 720), _dir('tendL_24_168', 'cruce', 24, 168, lado='largos'),
    _dir('tendL_168_720', 'cruce', 168, 720, lado='largos'), _dir('mom_24', 'impulso', 24), _dir('mom_168', 'impulso', 168),
    _dir('mom_720', 'impulso', 720), _dir('rev_12', 'rebote', 12), _dir('rev_24z', 'rebote', 24, forma='continua', k=math.sqrt(2.0)),
]


@njit(cache=True)
def hedge(Rx, activo, eta, reparto):
    """Rx[t, k]: rendimiento del experto k en la hora t; activo[t, k]: si ya compite. Devuelve el rendimiento
    del sistema (pesos de antes de cada hora) y los pesos medios."""
    T, K = Rx.shape
    lw = np.zeros(K)
    vivo = np.zeros(K, dtype=np.bool_)
    out = np.zeros(T)
    suma_w = np.zeros(K)
    for t in range(T):
        # entran los nuevos con el peso medio de los que ya están
        nuevos = 0
        for k in range(K):
            if activo[t, k] and not vivo[k]:
                nuevos += 1
        if nuevos:
            n_v = 0
            acc = 0.0
            for k in range(K):
                if vivo[k]:
                    acc += math.exp(lw[k]); n_v += 1
            base = math.log(acc / n_v) if n_v else 0.0
            for k in range(K):
                if activo[t, k] and not vivo[k]:
                    vivo[k] = True; lw[k] = base
        s = 0.0
        for k in range(K):
            if vivo[k]:
                s += math.exp(lw[k])
        if s <= 0:
            continue
        r = 0.0
        for k in range(K):
            if vivo[k]:
                w = math.exp(lw[k]) / s
                r += w * Rx[t, k]
                suma_w[k] += w
        out[t] = r
        # actualización multiplicativa y reparto fijo
        M = 0
        for k in range(K):
            if vivo[k]:
                lw[k] += eta * math.log(1.0 + max(Rx[t, k], -0.99)); M += 1
        s = 0.0
        for k in range(K):
            if vivo[k]:
                s += math.exp(lw[k])
        mx = -1e300
        for k in range(K):
            if vivo[k]:
                lw[k] = math.log((1 - reparto) * math.exp(lw[k]) / s + reparto / M)
                if lw[k] > mx:
                    mx = lw[k]
        for k in range(K):
            if vivo[k]:
                lw[k] -= mx
    return out, suma_w / max(T, 1)


def expertos_servidor(Mu, Ru, Fu, Fpago_u, hora, monedas_u, coste, extra=()):
    """Rendimientos horarios de los expertos de precio y funding del servidor (y de los extra del laboratorio)."""
    from .senales import objetivo
    i_btc = monedas_u.index('BTC')
    T, N = Ru.shape
    lista = Mu['lista']
    nombres, series, activos = [], [], []
    for e in list(EXPERTOS_PRECIO) + list(extra):
        obj = objetivo(e, Mu, i_btc)
        r, _ = simular(obj, Ru, Fu, hora, int(e['cada']), coste, BANDA)
        nombres.append(e['id']); series.append(r); activos.append(lista.any(axis=1))
    # contra la euforia del funding: -1 si el funding medio de 24 h supera el 30 % anual, +1 si baja de -10 %
    fa = Mu['fe24'] * 8760
    s = np.where(fa > 0.3, -1.0, np.where(fa < -0.1, 1.0, 0.0)) * (lista & np.isfinite(fa))
    n = lista.sum(axis=1).astype(float)
    with np.errstate(invalid='ignore', divide='ignore'):
        obj = np.nan_to_num(np.where(lista, s * np.minimum(1.0, VOL_OBJ_H / Mu['sig']) / n[:, None], 0.0))
    r, _ = simular(obj, Ru, Fu, hora, 1, coste, BANDA)
    nombres.append('fund_contra'); series.append(r); activos.append(lista.any(axis=1))
    # cobrar el funding (comprado al contado y vendido en perpetuo): solo cobra 2/3 del funding y paga su coste
    def carry(cands, umbral):
        idx = [monedas_u.index(m) for m in cands if m in monedas_u]
        f168 = Mu['fe168'][:, idx] * 8760
        f24 = Mu['fe24'][:, idx] * 8760
        if umbral is None:
            dentro = np.nan_to_num(f168) > 0
            pos = dentro / len(idx)
        else:
            dentro = (np.nan_to_num(f168) > umbral) & (np.nan_to_num(f24) > 0)
            pos = dentro / np.maximum(3, dentro.sum(axis=1))[:, None]
        giro = np.abs(np.diff(np.vstack([np.zeros((1, len(idx))), pos]), axis=0)).sum(axis=1)
        Fsig = np.zeros_like(pos)
        Fsig[:-1] = Fpago_u[1:, idx]
        return (pos * PARTE_CARRY * Fsig).sum(axis=1) - giro * PARTE_CARRY * COSTE_CARRY / 2, np.isfinite(Mu['fe168'][:, idx]).any(axis=1)
    r, act = carry(['BTC', 'ETH'], None)
    nombres.append('carry'); series.append(r); activos.append(act)
    r, act = carry(monedas_u, 0.1)
    nombres.append('carry_alt'); series.append(r); activos.append(act)
    nombres.append('btc_hold'); series.append(Ru[:, i_btc] - Fu[:, i_btc]); activos.append(Mu['lista'][:, i_btc] | (np.arange(T) > 0))
    nombres.append('efectivo'); series.append(np.zeros(T)); activos.append(np.ones(T, dtype=bool))
    return nombres, np.stack(series, axis=1), np.stack(activos, axis=1)
