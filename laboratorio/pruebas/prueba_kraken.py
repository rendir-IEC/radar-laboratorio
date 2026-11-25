"""Prueba sin red del estudio Kraken frente a Hyperliquid: cuentas con libros, series y costes inventados."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.comun import H  # noqa: E402
from lab.kraken import (alinear, base_hl, base_kraken, comparar_funding, comparar_precios, con_comisiones,  # noqa: E402
                        coste_ida, coste_mercado, funding_horario, informe)


def test_nombres():
    assert base_kraken('PF_XBTUSD') == ('BTC', 1)
    assert base_kraken('PF_XDGUSD') == ('DOGE', 1)
    assert base_kraken('PF_ETHUSD') == ('ETH', 1)
    assert base_kraken('PF_1000PEPEUSD') == ('PEPE', 1000)
    assert base_kraken('FI_XBTUSD_260327') is None
    assert base_kraken('PF_ETHEUR') is None
    assert base_hl('kPEPE') == ('PEPE', 1000)
    assert base_hl('BTC') == ('BTC', 1)
    print('OK    test_nombres')


def test_libro():
    # mitad 100; vender a 100.1 (10 u) y 100.3 (100 u). Comprar 2002 $ = 1001 a 100.1 + 1001 a 100.3
    ventas = [(100.1, 10), (100.3, 100)]
    compras = [(99.9, 10), (99.7, 100)]
    c = coste_mercado(ventas, 2002.0, 100.0)
    medio = 2002.0 / (1001 / 100.1 + 1001 / 100.3)
    assert abs(c - (medio / 100 - 1)) < 1e-12, c
    assert coste_mercado(ventas, 1e9, 100.0) is None  # el libro no alcanza
    assert abs(coste_mercado(ventas, 500.0, 100.0) - 0.001) < 1e-12  # cabe en el primer nivel: medio diferencial
    ida = coste_ida(compras, ventas, 500.0)
    assert abs(ida - 0.001) < 1e-12, ida
    print('OK    test_libro')


def test_precios_y_funding():
    rng = np.random.default_rng(1)
    t = np.arange(1000, dtype=np.int64) * H
    p = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 1000)))
    r = comparar_precios(t, p, t, p)
    assert r['correlacion'] > 0.9999 and r['seguimiento_pb_hora'] < 1e-6 and abs(r['diferencia_precio_pb']) < 1e-6
    q = p * (1 + rng.normal(0, 0.002, 1000))  # otro sitio con ruido propio
    r2 = comparar_precios(t[::2], p[::2], t, q)  # solo horas pares en uno: sin horas consecutivas no hay rendimientos
    assert r2 is None
    r3 = comparar_precios(t, p * 1.001, t, q)
    assert 0.5 < r3['correlacion'] < 1 and 20 < r3['seguimiento_pb_hora'] < 40 and 5 < r3['diferencia_precio_pb'] < 15, r3
    ta, a, b = alinear(t[:10], p[:10], t[5:20], p[5:20])
    assert len(ta) == 5
    # funding publicado cada 4 h: se reparte en tasa por hora
    filas = [(int(k * 4 * H), 0.0004) for k in range(50)]
    fh, inter = funding_horario(filas)
    assert inter == 4 and abs(fh[0][1] - 0.0001) < 1e-15
    hl = [(int(k * H), 0.0001) for k in range(200)]
    c = comparar_funding(fh, hl, 0)
    assert abs(c['kraken_anual_pct'] - 87.6) < 1e-6 and abs(c['diferencia_anual_pct']) < 1e-6
    print('OK    test_precios_y_funding')


def test_comisiones():
    sims = {'siempre_comprado_x': {'con_costes': {'rent_anual_pct': 9.0}, 'sin_costes': {'rent_anual_pct': 10.0}, 'giro_anual': 10},
            'lab_cruce_1_2_s_ser_amb_nf_h1': {'con_costes': {'rent_anual_pct': 0.0}, 'sin_costes': {'rent_anual_pct': 7.0}, 'giro_anual': 100}}
    r = con_comisiones(sims, {'a': 0.0007, 'b': 0.0014, 'c': 0.0}, coste_lab=0.0007)
    s = r['siempre_comprado_x']
    assert s['a'] == 9.0 and s['b'] == 8.0 and s['c'] == 10.0 and s['solo_compras']
    assert abs(s['coste_que_lo_anula_pct'] - 0.7) < 1e-9  # 10 puntos sin costes / 1 punto por cada 0,07 %
    x = r['lab_cruce_1_2_s_ser_amb_nf_h1']
    assert x['a'] == 0.0 and x['b'] == -7.0 and not x['solo_compras']
    # el informe se genera con lo mínimo
    txt = informe({'generado': 'x', 'eur_usd': 1.16, 'perpetuos_kraken': 1,
                   'comisiones': {'hyperliquid': {'taker': 0.00045}, 'kraken_futuros': {'taker': 0.0005}, 'kraken_contado': {'taker': 0.008}},
                   'monedas': [{'moneda': 'BTC', 'en_kraken': True, 'hyperliquid': {'coste_ida_pct': {'50': 0.05}},
                                'kraken': {'coste_ida_pct': {'50': 0.06}}, 'funding_intervalo_kraken_h': 4.0,
                                'funding_si_ya_es_horaria': {'kraken_anual_pct': 10.0}}],
                   'costes_por_giro': {'hyperliquid': 0.07, 'kraken_futuros': 0.075, 'kraken_contado': 0.825},
                   'estrategias': con_comisiones(sims, {'hyperliquid': 0.0007, 'kraken_futuros': 0.00075, 'kraken_contado': 0.0083})})
    assert 'Kraken frente a Hyperliquid' in txt and 'vende en corto' in txt and 'cada 4 h' in txt
    print('OK    test_comisiones')


if __name__ == '__main__':
    test_nombres()
    test_libro()
    test_precios_y_funding()
    test_comisiones()
