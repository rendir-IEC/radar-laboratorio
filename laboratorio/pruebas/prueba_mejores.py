"""Prueba sin red del estudio de los mejores: con habilidad persistente lo detecta; sin ella, no."""
import datetime as dt
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.mejores import estudiar  # noqa: E402

DIA = 86_400_000


def historias(persistente, n=300, meses=18, semilla=3):
    rng = np.random.default_rng(semilla)
    t0 = int(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)
    out = {}
    for i in range(n):
        habilidad = rng.normal(0, 0.10) if persistente else 0.0
        valor, pnl = 50_000.0, 0.0
        av, ph = [], []
        for d in range(meses * 30):
            r = habilidad / 30 + rng.normal(0, 0.02)
            ganancia = valor * r
            pnl += ganancia
            valor += ganancia
            av.append((t0 + d * DIA, valor))
            ph.append((t0 + d * DIA, pnl))
        out['0x%040x' % i] = {'valor': av, 'pnl': ph}
    return out


def test_detecta_habilidad():
    r = estudiar(historias(True))['resumen']
    assert r['correlacion_media'] > 0.2 and r['t_ventaja'] > 3, r


def test_sin_habilidad_no():
    r = estudiar(historias(False))['resumen']
    assert abs(r['correlacion_media']) < 0.1 and abs(r['t_ventaja']) < 3, r


if __name__ == '__main__':
    test_detecta_habilidad(); print('OK    test_detecta_habilidad')
    test_sin_habilidad_no(); print('OK    test_sin_habilidad_no')
