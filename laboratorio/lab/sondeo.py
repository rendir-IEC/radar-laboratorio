"""Sondeo de APIs públicas de otros mercados con cuentas públicas (dYdX, Drift, Lighter): qué responde y con qué forma.
Solo lecturas GET sin clave. Uso: python -m lab.sondeo --salida /tmp/son"""
import argparse
import json
import os
import time

from .datos import _http

AHORA_S = int(time.time())
DIA_S = 86400
URLS = {
    # dYdX v4 (indexer público)
    'dydx_mercados': 'https://indexer.dydx.trade/v4/perpetualMarkets?limit=2',
    'dydx_leaderboard_pnl': 'https://indexer.dydx.trade/v4/leaderboard/pnl?period=PERIOD_30D&limit=5',
    'dydx_leaderboard_pnl_b': 'https://indexer.dydx.trade/v4/leaderboard/pnl?period=PERIOD_ALL_TIME&limit=5',
    'dydx_trades': 'https://indexer.dydx.trade/v4/trades/perpetualMarket/BTC-USD?limit=3',
    'dydx_megavault': 'https://indexer.dydx.trade/v4/vault/v1/megavault/historicalPnl?resolution=day',
    # Drift (data API)
    'drift_markets': 'https://data.api.drift.trade/stats/markets',
    'drift_leaderboard': 'https://data.api.drift.trade/stats/leaderboard',
    'drift_leaderboard_b': 'https://data.api.drift.trade/leaderboard',
    'drift_trades': 'https://data.api.drift.trade/trades?symbol=SOL-PERP&limit=3',
    # Lighter (zkLighter)
    'lighter_info': 'https://mainnet.zklighter.elliot.ai/info',
    'lighter_cuenta_1': 'https://mainnet.zklighter.elliot.ai/api/v1/account?by=index&value=1',
    'lighter_cuenta_1000': 'https://mainnet.zklighter.elliot.ai/api/v1/account?by=index&value=1000',
    'lighter_pnl_1000': 'https://mainnet.zklighter.elliot.ai/api/v1/pnl?by=index&value=1000&resolution=1d&start_timestamp=%d&end_timestamp=%d&count_back=60' % (AHORA_S - 60 * DIA_S, AHORA_S),
    'lighter_leaderboard': 'https://mainnet.zklighter.elliot.ai/api/v1/leaderboard?type=weekly&l1_address=0x0000000000000000000000000000000000000000',
    'lighter_trades': 'https://mainnet.zklighter.elliot.ai/api/v1/recentTrades?market_id=1&limit=3',
    'lighter_libros': 'https://mainnet.zklighter.elliot.ai/api/v1/orderBooks',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='/tmp/son')
    a = ap.parse_args()
    os.makedirs(a.salida, exist_ok=True)
    out = {}
    for k, u in URLS.items():
        estado, b = _http(u, intentos=2, timeout=30)
        txt = b.decode('utf-8', 'replace') if b else ''
        claves = None
        try:
            j = json.loads(txt)
            claves = list(j.keys())[:20] if isinstance(j, dict) else ('lista de %d' % len(j))
        except ValueError:
            pass
        out[k] = {'url': u, 'estado': estado, 'bytes': len(b or b''), 'claves': claves, 'muestra': txt[:900]}
        print(k, estado, len(b or b''), claves, flush=True)
        time.sleep(0.5)
    with open(os.path.join(a.salida, 'sondeo.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
