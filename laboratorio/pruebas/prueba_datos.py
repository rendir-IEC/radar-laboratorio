"""Prueba sin red de la descarga y el montaje del panel: Binance y Hyperliquid simulados."""
import datetime as dt
import io
import json
import os
import sys
import tempfile
import time
import zipfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lab.datos as datos  # noqa: E402
from lab.comun import H  # noqa: E402

AHORA = int(time.time() * 1000) // H * H


def precio(coin, t_fin):
    base = {'BTCUSDT': 50000, 'ETHUSDT': 3000}.get(coin, 1.0)
    return base * (1 + 0.1 * np.sin(t_fin / H / 500))


def zip_csv(nombre, filas, cabecera):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        z.writestr(nombre, cabecera + '\n' + '\n'.join(','.join(str(x) for x in f) for f in filas))
    return b.getvalue()


def falso_http(url, cuerpo=None, intentos=5, timeout=60):
    if cuerpo is not None:
        if cuerpo['type'] == 'candleSnapshot':
            c = cuerpo['req']['coin']
            sym = 'HYPEHL' if c == 'HYPE' else c + 'USDT'
            out = [{'t': t, 'c': str(precio(sym, t + H) * (1.01 if c != 'HYPE' else 1)), 'v': '10'}
                   for t in range(cuerpo['req']['startTime'] // H * H, cuerpo['req']['endTime'] + 1, H)]
            return 200, json.dumps(out).encode()
        if cuerpo['type'] == 'fundingHistory':
            out = [{'coin': cuerpo['coin'], 'fundingRate': '0.00002', 'time': t}
                   for t in range(cuerpo['startTime'] // H * H + H, cuerpo['endTime'] + 1, H)][:500]
            return 200, json.dumps(out).encode()
    partes = url.split('/')
    sym = partes[-3] if '/klines/' in url else partes[-2]
    if sym not in ('BTCUSDT', 'ETHUSDT'):
        return 404, b''
    archivo = partes[-1]
    if '/klines/' in url:
        fecha = archivo.split('-1h-')[1][:-4]
        if len(fecha) == 7:
            y, m = map(int, fecha.split('-'))
            d0 = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
            d1 = dt.datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=dt.timezone.utc)
        else:
            d0 = dt.datetime.fromisoformat(fecha).replace(tzinfo=dt.timezone.utc)
            d1 = d0 + dt.timedelta(days=1)
        filas = []
        t = int(d0.timestamp() * 1000)
        while t < int(d1.timestamp() * 1000) and t + H <= AHORA - 2 * 86400000:
            p = precio(sym, t + H)
            filas.append([t, p, p, p, p, 1, t + H - 1, 1000, 1, 0.5, 500, 0])
            t += H
        if not filas:
            return 404, b''
        return 200, zip_csv('k.csv', filas, 'open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore')
    if '/fundingRate/' in url:
        y, m = map(int, archivo.split('-fundingRate-')[1][:-4].split('-'))
        d0 = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
        filas = [[int((d0 + dt.timedelta(hours=8 * i)).timestamp() * 1000) + 3, 8, 0.0001] for i in range(90)]
        return 200, zip_csv('f.csv', filas, 'calc_time,funding_interval_hours,last_funding_rate')
    return 404, b''


def test_panel():
    datos._http = falso_http
    datos.PRESUPUESTO_HL = 1e9
    with tempfile.TemporaryDirectory() as d:
        os.environ['LAB_DATOS'] = d
        reg = {}
        p = datos.construir_panel(['BTC', 'ETH', 'HYPE'], registro=reg)
        P, t = p['P'], p['t']
        assert reg.get('binance_descargas'), reg
        # BTC: precio de Binance al cierre de cada hora, sin saltos en el empalme con Hyperliquid
        k = len(t) // 2
        assert abs(P[k, 0] - precio('BTCUSDT', int(t[k]))) < 1e-6 * P[k, 0]
        r = np.diff(np.log(P[:, 0]))
        assert np.nanmax(np.abs(r)) < 0.01, np.nanmax(np.abs(r))
        assert np.isfinite(P[-1, 0]), 'las últimas horas las rellena Hyperliquid'
        # HYPE no está en Binance: solo las 5000 h de Hyperliquid
        assert np.isfinite(P[:, 2]).sum() in (5000, 5001), np.isfinite(P[:, 2]).sum()
        # funding: Binance paga cada 8 h la tasa entera; la información es la tasa por hora y nunca se adelanta
        i = int(np.argmax(p['Fpago'][:, 0] > 0))
        assert abs(p['Fpago'][i, 0] - 0.0001) < 1e-12
        assert np.isnan(p['Finfo'][i - 1, 0]) or abs(p['Finfo'][i - 1, 0] - 0.0001 / 8) > 0 or i == 0
        assert abs(p['Finfo'][i, 0] - 0.0001 / 8) < 1e-12
        assert abs(p['Fpago'][-1, 0] - 0.00002) < 1e-12, 'al final manda el funding horario de Hyperliquid'
        # segunda vez: todo sale de la caché
        reg2 = {}
        datos.construir_panel(['BTC', 'ETH', 'HYPE'], registro=reg2)
        assert sum(reg2.get('binance_descargas', {}).values()) <= 60, reg2


if __name__ == '__main__':
    test_panel()
    print('OK    test_panel')
