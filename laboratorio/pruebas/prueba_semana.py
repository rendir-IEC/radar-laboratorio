"""Prueba sin red de «dónde está la ventaja esta semana»: con tendencia persistente la regla acierta y la cartera de las
3 mejores gana a tenerlas todas; en un paseo aleatorio no hay ventaja. También: JSON sin NaN y la señal de hoy."""
import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab import semana  # noqa: E402


def series(con_tendencia, semilla=1, dias=3000):
    rng = np.random.default_rng(semilla)
    idx = pd.date_range('2015-01-01', periods=dias, freq='D', tz='UTC')
    out = {}
    for sim, *_ in semana.MERCADOS:
        if con_tendencia:
            # rachas de tendencia de ~20 semanas que cambian de signo
            regimen = np.repeat(rng.choice([-1, 1], size=dias // 140 + 1), 140)[:dias]
            deriva = regimen * 0.0025
        else:
            deriva = np.zeros(dias)
        r = deriva + rng.normal(0, 0.02, dias)
        out[sim] = pd.Series(100 * np.exp(np.cumsum(r)), index=idx)
    return out


def main():
    s1 = series(True)
    P = semana.semanal(s1)
    _, _, _, pm, cart, glob, top, pesos = semana.estudiar(P)
    assert glob['aciertoPct'] > 55, glob
    assert cart['top3']['anualPct'] > cart['todosIgual']['anualPct'], cart
    assert abs(pesos.sum(axis=1).max() - 1) < 1e-9 and pesos.min().min() >= 0
    s0 = series(False, semilla=4)
    _, _, _, pm0, cart0, glob0, _, _ = semana.estudiar(semana.semanal(s0))
    assert 45 < glob0['aciertoPct'] < 55 and abs(glob0['alzaYBaja']['t']) < 3, glob0
    h = semana.hoy(s1, pm)
    assert len(h) == len(semana.MERCADOS) and sum(f['enTop3'] for f in h) <= 3
    assert [f['puesto'] for f in h] == list(range(1, len(h) + 1)) and h == sorted(h, key=lambda f: -f['puntuacion'])
    assert all(f['enTop3'] <= (f['puntuacion'] > 0) for f in h)
    txt = json.dumps(semana.limpio({'a': float('nan'), 'b': [np.float64(1.5), np.int64(2), np.bool_(True)]}), allow_nan=False)
    assert txt == '{"a": null, "b": [1.5, 2, true]}', txt
    res = {'generado': 'x', 'hoy': h, 'cartera': cart, 'global': glob, 'fuentes': {'BTC': 'prueba'}}
    assert 'Esta semana' in semana.informe(semana.limpio(res))
    print('prueba_semana: OK', 'acierto con tendencia', glob['aciertoPct'], 'sin tendencia', glob0['aciertoPct'], 'top3', cart['top3']['anualPct'], 'todos', cart['todosIgual']['anualPct'])


if __name__ == '__main__':
    main()
