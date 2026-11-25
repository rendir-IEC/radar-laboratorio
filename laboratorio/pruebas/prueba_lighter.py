"""Prueba sin red del estudio de Lighter: formato del historial, cuentas no puras fuera y habilidad plantada detectada."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.lighter import informe, serie  # noqa: E402
from lab.mejores import estudiar  # noqa: E402

T0 = 1_735_689_600  # 1-1-2025 en segundos


def filas(habilidad, rng, dias=420, deposito=50_000.0, pool=0.0):
    out, pnl, valor = [], 0.0, deposito
    for d in range(dias):
        g = valor * (habilidad / 30 + rng.normal(0, 0.02))
        pnl += g
        valor += g
        out.append({'timestamp': T0 + d * 86400, 'trade_pnl': pnl, 'inflow': deposito, 'outflow': 0.0, 'pool_inflow': pool, 'pool_outflow': 0.0,
                    'spot_inflow': 0, 'spot_outflow': 0, 'trade_spot_pnl': 0, 'pool_pnl': 0, 'volume': 0})
    return out


def test_serie():
    rng = np.random.default_rng(1)
    s = serie(filas(0.0, rng, dias=5))
    assert len(s['valor']) == 5 and s['valor'][0][0] == T0 * 1000
    assert abs(s['valor'][-1][1] - (50_000 + s['pnl'][-1][1])) < 1e-6
    assert serie(filas(0.0, rng, dias=5, pool=10_000)) is None  # con fondo de liquidez: fuera
    assert serie([]) is None
    print('OK    test_serie')


def test_habilidad():
    for persistente, debe in ((True, True), (False, False)):
        rng = np.random.default_rng(3)
        h = {str(i): serie(filas(rng.normal(0, 0.10) if persistente else 0.0, rng)) for i in range(300)}
        r = estudiar(h)
        t = r['resumen']['t_correlacion']
        assert (t > 4) == debe, (persistente, r['resumen'])
    txt = informe({'generado': 'x', 'activas_vistas': 10, 'activas': 10, 'azar': 5, 'maximo': 100, 'historiales': 300, 'min_valor': 10000, 'estudio': r})
    assert 'Lighter' in txt and 'dYdX no se estudia' in txt
    print('OK    test_habilidad')


if __name__ == '__main__':
    test_serie()
    test_habilidad()
