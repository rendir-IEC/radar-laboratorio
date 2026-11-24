"""Pruebas contra la suerte.

- Sharpe deflactado (Bailey y López de Prado, 2014): probabilidad de que el Sharpe real sea > 0 teniendo en
  cuenta cuántas estrategias se probaron, la asimetría y las colas.
- Probabilidad de sobreajuste por validación cruzada combinatoria simétrica (CSCV, Bailey et al., 2017).
- Selección paso a paso hacia delante: cuánto habría ganado, fuera de muestra, el propio procedimiento de
  elegir las mejores con la historia disponible en cada momento.
"""
import itertools
import math

import numpy as np
from scipy.stats import norm

GAMMA = 0.5772156649015329
DIAS_ANO = 365.0


def sharpe(x, axis=0):
    m = x.mean(axis=axis)
    s = x.std(axis=axis, ddof=1)
    with np.errstate(invalid='ignore', divide='ignore'):
        return np.where(s > 0, m / s, 0.0)


def momentos(x):
    """Asimetría y curtosis (no en exceso) por columna."""
    m = x.mean(axis=0)
    d = x - m
    s = d.std(axis=0)
    with np.errstate(invalid='ignore', divide='ignore'):
        g3 = np.where(s > 0, (d ** 3).mean(axis=0) / s ** 3, 0.0)
        g4 = np.where(s > 0, (d ** 4).mean(axis=0) / s ** 4, 3.0)
    return g3, g4


def sharpe_esperado_maximo(var_sr, n):
    """Máximo Sharpe esperado (por periodo) entre n pruebas sin ventaja real."""
    if n <= 1:
        return 0.0
    return math.sqrt(max(var_sr, 0.0)) * ((1 - GAMMA) * norm.ppf(1 - 1.0 / n) + GAMMA * norm.ppf(1 - 1.0 / (n * math.e)))


def psr(sr, sr0, T, g3, g4):
    """Probabilidad de que el Sharpe real supere sr0 (todo por periodo, no anualizado)."""
    den = np.sqrt(np.maximum(1 - g3 * sr + (g4 - 1) / 4.0 * sr ** 2, 1e-12))
    return norm.cdf((sr - sr0) * math.sqrt(max(T - 1, 1)) / den)


def deflactado(D, n_pruebas=None):
    """D[d, m]: rendimientos diarios de m estrategias. Devuelve Sharpe diario, DSR y el umbral SR0.
    El umbral es el máximo Sharpe que darían n pruebas sin ventaja: cada Sharpe estimado se dispersa solo por
    ruido de muestreo, con varianza 1/(T-1). No se usa la varianza entre estrategias porque incluye diferencias
    reales que no son suerte (p. ej., las que se hunden por comisiones), y eso subiría el listón sin motivo.
    El número de pruebas se toma tal cual (sin descontar correlaciones): es prudente."""
    T, M = D.shape
    sr = sharpe(D)
    g3, g4 = momentos(D)
    n = n_pruebas or M
    sr0 = sharpe_esperado_maximo(1.0 / max(T - 1, 1), n)
    return sr, psr(sr, sr0, T, g3, g4), sr0


def umbral_empirico(D, n_pruebas=None):
    """Variante de Bailey y López de Prado con la varianza de los Sharpe entre estrategias (solo informativa)."""
    sr = sharpe(D)
    return sharpe_esperado_maximo(float(np.var(sr, ddof=1)) if D.shape[1] > 1 else 0.0, n_pruebas or D.shape[1])


def pbo_cscv(D, S=16, trozo=1500):
    """Probabilidad de sobreajuste: en cuántas particiones mitad/mitad la mejor estrategia dentro de muestra
    queda por debajo de la mediana fuera de muestra."""
    T, M = D.shape
    S = min(S, max(2, (T // 20) // 2 * 2))
    lim = np.linspace(0, T, S + 1).astype(int)
    s1 = np.stack([D[lim[i]:lim[i + 1]].sum(axis=0) for i in range(S)])
    s2 = np.stack([(D[lim[i]:lim[i + 1]] ** 2).sum(axis=0) for i in range(S)])
    nb = np.diff(lim).astype(np.float64)
    tot1, tot2, totn = s1.sum(0), s2.sum(0), nb.sum()
    combos = np.array([c for c in itertools.combinations(range(S), S // 2)], dtype=np.int64)
    A = np.zeros((len(combos), S))
    for i, c in enumerate(combos):
        A[i, c] = 1.0
    lambdas = []
    for k in range(0, len(A), trozo):
        a = A[k:k + trozo]
        n_in = a @ nb
        i1, i2 = a @ s1, a @ s2
        o1, o2, n_out = tot1 - i1, tot2 - i2, totn - n_in
        def sr(x1, x2, n):
            m = x1 / n[:, None]
            v = np.maximum(x2 / n[:, None] - m * m, 1e-18)
            return m / np.sqrt(v)
        sr_in, sr_out = sr(i1, i2, n_in), sr(o1, o2, n_out)
        mejor = np.argmax(sr_in, axis=1)
        sr_mejor_out = sr_out[np.arange(len(a)), mejor]
        rango = (sr_out < sr_mejor_out[:, None]).sum(axis=1) + 0.5 * ((sr_out == sr_mejor_out[:, None]).sum(axis=1) - 1) + 1
        w = rango / (M + 1.0)
        lambdas.append(np.log(w / (1 - w)))
    lam = np.concatenate(lambdas)
    return float((lam <= 0).mean()), int(S), int(len(lam))


def resumen_serie(r):
    """r: rendimientos diarios. Rentabilidad anual compuesta, volatilidad, Sharpe anual y caída máxima."""
    r = np.asarray(r, dtype=np.float64)
    if r.size < 2:
        return {'dias': int(r.size)}
    lg = np.log1p(np.maximum(r, -0.99))
    c = np.r_[0.0, np.cumsum(lg)]
    caida = float((1 - np.exp(c - np.maximum.accumulate(c))).max())
    return {
        'dias': int(r.size),
        'rent_anual_pct': float((math.exp(lg.mean() * DIAS_ANO) - 1) * 100),
        'vol_anual_pct': float(r.std(ddof=1) * math.sqrt(DIAS_ANO) * 100),
        'sharpe_anual': float(sharpe(r) * math.sqrt(DIAS_ANO)),
        'caida_max_pct': caida * 100,
        'dias_positivos_pct': float((r[r != 0] > 0).mean() * 100) if (r != 0).any() else 0.0,
        'semanas_positivas_pct': _semanas_positivas(r),
        'dias_con_posicion_pct': float((r != 0).mean() * 100),
    }


def _semanas_positivas(r):
    """Porcentaje de semanas en positivo, contando solo las semanas en que hubo posición."""
    sem = np.add.reduceat(r, np.arange(0, r.size, 7))
    activas = np.add.reduceat(np.abs(r), np.arange(0, r.size, 7)) > 0
    return float((sem[activas] > 0).mean() * 100) if activas.any() else 0.0


def paso_a_paso(D, k=5, inicio=365, paso=91, min_dias=180, activa=None):
    """Selección hacia delante: cada `paso` días elige las k estrategias con mejor Sharpe hasta ese día
    (solo con lo que se sabía) y las mantiene a partes iguales el periodo siguiente."""
    T, M = D.shape
    activa = activa if activa is not None else np.ones_like(D, dtype=bool)
    fuera = np.zeros(T)
    usado = np.zeros(T, dtype=bool)
    elecciones = []
    for d in range(inicio, T, paso):
        hist = D[:d]
        dias_vivos = activa[:d].sum(axis=0)
        sr = np.where(dias_vivos >= min_dias, sharpe(hist), -np.inf)
        elegidas = np.argsort(-sr)[:k]
        elegidas = elegidas[np.isfinite(sr[elegidas])]
        if not len(elegidas):
            continue
        fin = min(T, d + paso)
        fuera[d:fin] = D[d:fin, elegidas].mean(axis=1)
        usado[d:fin] = True
        elecciones.append((d, [int(i) for i in elegidas]))
    return fuera[usado], usado, elecciones


def diversas(orden, D, max_corr=0.85, n=10):
    """Toma estrategias en el orden dado saltándose las que se parecen demasiado (correlación diaria) a una ya elegida."""
    elegidas = []
    for i in orden:
        x = D[:, i]
        if x.std() == 0:
            continue
        if all(abs(np.corrcoef(x, D[:, j])[0, 1]) < max_corr for j in elegidas):
            elegidas.append(int(i))
        if len(elegidas) >= n:
            break
    return elegidas
