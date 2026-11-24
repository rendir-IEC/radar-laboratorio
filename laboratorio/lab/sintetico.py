"""Mercados sintéticos para probar el laboratorio sin red.
- 'ruido': paseos aleatorios con volatilidad cambiante y funding; no hay ventaja que encontrar.
- 'impulso': igual, pero con una ventaja plantada: la deriva de cada hora sigue el signo de la última semana."""
import numpy as np

from .comun import H


def panel_sintetico(monedas, horas=24 * 365 * 4, mundo='ruido', fuerza=0.04, semilla=7, inicio_ms=1_609_459_200_000):
    rng = np.random.default_rng(semilla)
    N = len(monedas)
    t = inicio_ms + H * np.arange(horas, dtype=np.int64)
    vol_anual = rng.uniform(0.5, 1.2, N)
    sig_h = vol_anual / np.sqrt(8760)
    # volatilidad que cambia lentamente (factor log-normal AR(1))
    z = np.zeros((horas, N))
    eps_v = rng.standard_normal((horas, N)) * 0.02
    for k in range(1, horas):
        z[k] = 0.999 * z[k - 1] + eps_v[k]
    sig = sig_h * np.exp(z - z.std(axis=0) ** 2 / 2)
    mercado = rng.standard_normal(horas)  # factor común
    eps = 0.6 * mercado[:, None] + 0.8 * rng.standard_normal((horas, N))
    r = sig * eps
    if mundo == 'impulso':
        lr = np.zeros((horas, N))
        for k in range(1, horas):
            pasado = lr[max(0, k - 168):k].sum(axis=0)
            lr[k] = r[k] + fuerza * sig[k] * np.sign(pasado)
        r = lr
    lp = np.cumsum(r, axis=0) + np.log(rng.uniform(1, 1000, N))
    P = np.exp(lp)
    # algunas monedas empiezan más tarde
    for j in range(N):
        if j >= 3 and rng.random() < 0.4:
            P[: rng.integers(0, horas // 2), j] = np.nan
    f = 0.0000125 + 0.00002 * np.sin(np.arange(horas)[:, None] / 400 + rng.uniform(0, 6, N)) + rng.normal(0, 0.000005, (horas, N))
    f = np.where(np.isnan(P), 0.0, f)
    Finfo = np.where(np.isnan(P), np.nan, f)
    return {'t': t, 'monedas': list(monedas), 'P': P, 'V': np.full_like(P, np.nan), 'TB': np.full_like(P, np.nan),
            'Fpago': f, 'Finfo': Finfo, 'fuente': {m: 'sintético ' + mundo for m in monedas}, 'registro': {'sintetico': mundo}}
