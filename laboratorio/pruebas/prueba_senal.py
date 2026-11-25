"""Prueba sin red de la señal diaria: cartera de 5 compradas y 5 vendidas entre las operables, con banda."""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.senal import PESO, a_servidor, calcular, cartera_nueva, top_por_volumen  # noqa: E402


def _dd(n=30, dias=800, semilla=3):
    rng = np.random.default_rng(semilla)
    idx = pd.date_range('2024-06-01', periods=dias, freq='D', tz='UTC')
    dd = {}
    nombres = ['BTCUSDT', '1000PEPEUSDT'] + ['C%02dUSDT' % i for i in range(n - 2)]
    for i, s in enumerate(nombres):
        r = rng.normal(0, 0.03, dias)
        lr = np.zeros(dias)
        for k in range(1, dias):  # impulso plantado: la deriva sigue a la última semana
            lr[k] = r[k] + 0.004 * np.sign(lr[max(0, k - 7):k].sum())
        c = 100 * np.exp(np.cumsum(lr))
        dd[s] = pd.DataFrame({'open': c / np.exp(lr), 'high': c * 1.01, 'low': c * 0.99, 'close': c,
                              'vol': rng.uniform(1, 2, dias) * (n - i) * 1e6, 'tb': 0.5e6, 'f': 0.0001}, index=idx)
    return dd, idx


def test_nombres():
    assert a_servidor('BTCUSDT') == 'BTC' and a_servidor('1000PEPEUSDT') == 'kPEPE' and a_servidor('ETHBUSD') is None
    print('OK    test_nombres')


def test_cartera():
    pred = pd.Series(np.arange(20, dtype=float), index=['S%02dUSDT' % i for i in range(20)])
    oper = {'S%02d' % i for i in range(20)}
    w = cartera_nueva(pred, oper, None)
    assert sorted(m for m, x in w.items() if x > 0) == ['S15', 'S16', 'S17', 'S18', 'S19']
    assert sorted(m for m, x in w.items() if x < 0) == ['S00', 'S01', 'S02', 'S03', 'S04']
    assert all(abs(abs(x) - PESO) < 1e-12 for x in w.values()) and abs(sum(abs(x) for x in w.values()) - 1.0) < 1e-12
    # banda: S10 comprada antes sigue entre las 15 mejores, se queda; S04 (vendida) también
    w2 = cartera_nueva(pred, oper, {'S10': PESO, 'S04': -PESO, 'S00': -PESO})
    assert 'S10' in w2 and w2['S10'] > 0 and w2['S04'] < 0 and sum(1 for x in w2.values() if x > 0) == 5
    # solo operables: S19 no se puede operar en el servidor
    w3 = cartera_nueva(pred, oper - {'S19'}, None)
    assert 'S19' not in w3 and 'S14' in w3
    assert cartera_nueva(pred[:6], oper, None) == {}
    print('OK    test_cartera')


def test_calcular():
    dd, idx = _dd()
    oper = {a_servidor(s) for s in list(dd)[:18]}
    hoy = idx[-1] + pd.Timedelta(days=1)
    r = calcular({s: d.copy() for s, d in dd.items()}, None, hoy, operables=oper)
    assert r['fecha'] == str(idx[-1].date()), r['fecha']
    w = r['cartera']
    assert sum(1 for x in w.values() if x > 0) == 5 and sum(1 for x in w.values() if x < 0) == 5, w
    assert set(w) <= oper
    assert len(r['universo']) == 20 and r['dias_de_entrenamiento'] > 600
    # con impulso plantado, lo comprado ha subido más la última semana que lo vendido
    sem = {a_servidor(s): float(np.log(d['close'].iloc[-1] / d['close'].iloc[-8])) for s, d in dd.items()}
    assert np.mean([sem[m] for m, x in w.items() if x > 0]) > np.mean([sem[m] for m, x in w.items() if x < 0])
    # al día siguiente, con la cartera anterior, la banda mantiene casi todo
    r2 = calcular({s: d.copy() for s, d in dd.items()}, r, hoy, operables=oper)
    assert r2['cartera'] == w and r2['anterior'] == w
    t3 = top_por_volumen(dd, idx[-40], 3)
    assert len(t3) == 3 and set(t3) <= {'BTCUSDT', '1000PEPEUSDT', 'C00USDT', 'C01USDT', 'C02USDT'}, t3
    print('OK    test_calcular  (compradas %s; vendidas %s)' % (sorted(m for m, x in w.items() if x > 0), sorted(m for m, x in w.items() if x < 0)))


if __name__ == '__main__':
    test_nombres()
    test_cartera()
    test_calcular()
