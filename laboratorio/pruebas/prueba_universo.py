"""Prueba sin red del universo de cada momento: listado de data.binance.vision, pertenencia sin mirar al futuro,
monedas que mueren, carteras con banda y el aprendizaje automático de punta a punta."""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.comun import MONEDAS_SERVIDOR  # noqa: E402
from lab.ml import _elegir, cartera, diario, evaluar_dd  # noqa: E402
from lab.sintetico import panel_sintetico  # noqa: E402
from lab.ml import preparar_dd  # noqa: E402
from lab.universo import _xml_lista, es_moneda, fin_de_semana_quieto, no_cripto, pertenencia, rendimiento_siguiente  # noqa: E402


def test_listado():
    xml = ('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>data.binance.vision</Name>'
           '<Prefix>data/futures/um/monthly/klines/</Prefix><Marker></Marker><NextMarker>data/futures/um/monthly/klines/BTCUSDT/</NextMarker>'
           '<MaxKeys>1000</MaxKeys><Delimiter>/</Delimiter><IsTruncated>true</IsTruncated>'
           '<CommonPrefixes><Prefix>data/futures/um/monthly/klines/1000PEPEUSDT/</Prefix></CommonPrefixes>'
           '<CommonPrefixes><Prefix>data/futures/um/monthly/klines/BTCUSDT/</Prefix></CommonPrefixes></ListBucketResult>')
    p, k, trunc, sig = _xml_lista(xml)
    assert p == ['data/futures/um/monthly/klines/1000PEPEUSDT/', 'data/futures/um/monthly/klines/BTCUSDT/'], p
    assert trunc and sig.endswith('BTCUSDT/') and k == []
    xml2 = ('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>data/futures/um/monthly/klines/LUNAUSDT/1d/'
            'LUNAUSDT-1d-2022-04.zip</Key></Contents><Contents><Key>data/futures/um/monthly/klines/LUNAUSDT/1d/'
            'LUNAUSDT-1d-2022-04.zip.CHECKSUM</Key></Contents></ListBucketResult>')
    p, k, trunc, sig = _xml_lista(xml2)
    assert not trunc and len(k) == 2 and p == []
    assert es_moneda('BTCUSDT') and es_moneda('1000PEPEUSDT') and es_moneda('LUNAUSDT')
    assert not es_moneda('BTCUSDT_240329') and not es_moneda('USDCUSDT') and not es_moneda('BTCDOMUSDT') and not es_moneda('ETHBUSD')
    print('OK    test_listado')


def _dd(n=30, dias=420, semilla=2):
    rng = np.random.default_rng(semilla)
    idx = pd.date_range('2021-01-01', periods=dias, freq='D', tz='UTC')
    dd = {}
    for i in range(n):
        c = 100 * np.exp(np.cumsum(rng.normal(0, 0.04, dias)))
        d = pd.DataFrame({'open': c, 'high': c * 1.02, 'low': c * 0.98, 'close': c, 'vol': rng.uniform(1, 2, dias) * (n - i) * 1e6,
                          'tb': 0.5e6, 'f': 0.0001}, index=idx)
        dd['C%02dUSDT' % i] = d
    return dd, idx


def test_pertenencia():
    dd, idx = _dd()
    # C29 (la de menos volumen) tiene un volumen enorme en marzo: no puede entrar en marzo, sí en abril
    dd['C29USDT'].loc['2021-03-01':'2021-03-31', 'vol'] = 1e12
    # C00 (la de más volumen) muere el 10 de abril
    dd['C00USDT'].loc['2021-04-11':, ['open', 'high', 'low', 'close', 'vol']] = np.nan
    # C01 solo tiene 10 días de datos en mayo: no entra en junio
    dd['C01USDT'].loc['2021-05-01':'2021-05-21', ['close', 'vol']] = np.nan
    m, orden = pertenencia(dd, 10)
    assert '2021-01' not in orden  # el primer mes no tiene mes anterior
    assert 'C29USDT' not in orden['2021-03'] and orden['2021-04'][0] == 'C29USDT'
    assert not m['C29USDT']['2021-03-15'] and m['C29USDT']['2021-04-15']
    assert m['C00USDT']['2021-04-10'] and not m['C00USDT']['2021-04-11']
    assert 'C01USDT' not in orden['2021-06'] and 'C01USDT' in orden['2021-05']
    assert all(len(v) == 10 for v in orden.values())
    # rendimiento del día siguiente: la que muere cierra a 0 su último día; las vivas no tienen rendimiento el último día
    fin = idx[-1]
    y0 = rendimiento_siguiente(dd['C00USDT'], fin)
    assert y0['2021-04-10'] == 0.0 and np.isnan(y0['2021-04-11'])
    y2 = rendimiento_siguiente(dd['C02USDT'], fin)
    assert np.isnan(y2.iloc[-1]) and abs(y2.iloc[0] - (dd['C02USDT']['close'].iloc[1] / dd['C02USDT']['close'].iloc[0] - 1)) < 1e-12
    print('OK    test_pertenencia')


def test_no_cripto_y_funding():
    idx = pd.date_range('2026-01-01', periods=150, freq='D', tz='UTC')
    rng = np.random.default_rng(1)
    r = rng.normal(0, 0.02, 150)
    r[idx.dayofweek >= 5] *= 0.1  # como el oro o una acción: casi quieto en fin de semana
    oro = pd.DataFrame({'close': 100 * np.exp(np.cumsum(r))}, index=idx)
    cr = pd.DataFrame({'close': 100 * np.exp(np.cumsum(rng.normal(0, 0.03, 150)))}, index=idx)
    assert fin_de_semana_quieto(oro) and not fin_de_semana_quieto(cr)
    assert no_cripto({'XAUUSDT': cr, 'NVDAUSDT': cr, 'RAROUSDT': oro, 'BTCUSDT': cr, 'LITUSDT': cr}) == ['NVDAUSDT', 'RAROUSDT', 'XAUUSDT']
    # el rendimiento que aprende el modelo descuenta el funding del día siguiente (lo paga el comprado)
    dd = {}
    for m, f in (('BTC', 0.0), ('AAA', 0.001), ('BBB', -0.002)):
        c = 100 * np.exp(np.cumsum(rng.normal(0, 0.02, 150)))
        dd[m] = pd.DataFrame({'open': c, 'high': c * 1.01, 'low': c * 0.99, 'close': c, 'vol': 1e6, 'tb': 5e5, 'f': f}, index=idx)
    df, Xn, yn, feats = preparar_dd(dd)
    for m, f in (('AAA', 0.001), ('BBB', -0.002)):
        c = dd[m]['close']
        bruto = (c.shift(-1) / c - 1).reindex(df.xs(m, level=1).index)
        assert np.allclose(df.xs(m, level=1)['_y'].dropna(), (bruto - f).dropna()), m
    print('OK    test_no_cripto_y_funding')


def test_banda():
    assert _elegir(list('abcdefgh'), 3, None, set()) == ['a', 'b', 'c']
    assert _elegir(list('abcdefgh'), 3, 6, {'f', 'h'}) == ['f', 'a', 'b']  # f sigue entre las 6 primeras; h no
    rng = np.random.default_rng(4)
    idx = pd.MultiIndex.from_product([pd.date_range('2023-01-01', periods=300, freq='D', tz='UTC'), ['M%02d' % i for i in range(40)]], names=['dia', '_moneda'])
    df = pd.DataFrame({'_y': rng.normal(0, 0.03, len(idx))}, index=idx)
    pred = pd.Series(rng.normal(size=len(idx)), index=idx)
    # predicción que cambia poco de un día a otro: la banda reduce mucho el giro
    pred = pred.groupby(level=1).transform(lambda s: s.ewm(alpha=0.1).mean())
    _, g0 = cartera(df, pred, 5, 'largo_corto', 0.0)
    _, g1 = cartera(df, pred, 5, 'largo_corto', 0.0, salida=15)
    assert g1 < 0.6 * g0, (g0, g1)
    r0, _ = cartera(df, pred, 5, 'solo_compras', 0.0)
    r1, _ = cartera(df, pred, 5, 'solo_compras', 0.001)
    assert (r1 <= r0 + 1e-15).all()
    print('OK    test_banda')


def test_punta_a_punta():
    """Mercado con impulso plantado: con un universo de cada momento que cambia, el modelo sigue encontrándolo."""
    monedas = list(MONEDAS_SERVIDOR)
    panel = panel_sintetico(monedas, horas=24 * 365 * 3, mundo='impulso', semilla=5)
    dd = diario(panel, list(range(len(monedas))))
    rng = np.random.default_rng(1)
    for m, d in dd.items():
        d['vol'] = rng.uniform(1, 3, len(d)) * 1e6
        d.drop(columns=['n'], inplace=True)
    # una moneda muere a mitad
    corte = dd['SOL'].index[len(dd['SOL']) // 2]
    dd['SOL'].loc[corte:, ['open', 'high', 'low', 'close', 'vol']] = np.nan
    fin = max(d.index[-1] for d in dd.values())
    for d in dd.values():
        d['y'] = rendimiento_siguiente(d, fin)
    miembros, _ = pertenencia(dd, 12)
    r = evaluar_dd(dd, miembros, 'prueba', 0.0007, btc='BTC')
    assert r['ic_medio'] > 0.03 and r['t_ic'] > 3, r
    assert r['monedas_por_dia'] <= 12
    assert set(r['carteras']) >= {'lenta_largo_corto_k5', 'lenta_solo_compras_k5_un_dia_tarde'}
    print('OK    test_punta_a_punta  (IC %.3f, t %.1f; un día tarde %.3f)' % (r['ic_medio'], r['t_ic'], r['ic_un_dia_tarde']))


if __name__ == '__main__':
    test_listado()
    test_pertenencia()
    test_no_cripto_y_funding()
    test_banda()
    test_punta_a_punta()
