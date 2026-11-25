"""Aprender de los mejores en Lighter (perpetuos descentralizados con cuentas públicas): ¿los que ganan siguen ganando?

Mismo estudio que en Hyperliquid (lab/mejores.py), con datos públicos de Lighter, sin clave:
- cuentas: las que aparecen en las operaciones recientes de todos los mercados (activas hoy) y otras elegidas al azar
  entre todos los números de cuenta (para no quedarse solo con las que siguen vivas);
- historial diario de cada cuenta (/api/v1/pnl): resultado acumulado de sus operaciones de perpetuos y depósitos.
Rendimiento del mes = resultado del mes / dinero de la cuenta al empezarlo (depósitos netos + resultado acumulado).
Solo cuentas de perpetuos puras (sin fondo de liquidez ni contado, cuyas entradas y salidas no se pueden separar bien).

Uso: python -m lab.lighter --salida /tmp/lig [--activas 1200 --azar 600]
"""
import argparse
import datetime as dt
import json
import os
import random
import time

from .datos import _http
from .mejores import estudiar

LIGHTER = 'https://mainnet.zklighter.elliot.ai'
SUBCUENTA = 2 ** 47   # los números de subcuenta empiezan muy arriba
DIA = 86_400_000
_ULTIMA = [0.0]


def _get(ruta, pausa=0.45):
    espera = _ULTIMA[0] + pausa - time.time()
    if espera > 0:
        time.sleep(espera)
    _ULTIMA[0] = time.time()
    estado, b = _http(LIGHTER + ruta, intentos=3, timeout=60)
    if estado != 200 or not b:
        return None
    try:
        return json.loads(b)
    except ValueError:
        return None


def mercados():
    j = _get('/api/v1/orderBooks') or {}
    return [m['market_id'] for m in (j.get('order_books') or []) if m.get('market_type', 'perp') == 'perp' and m.get('status', 'active') == 'active']


def cuentas_activas(ids_mercado, por_mercado=100):
    vistas = set()
    for m in ids_mercado:
        j = _get('/api/v1/recentTrades?market_id=%d&limit=%d' % (m, por_mercado)) or {}
        for t in j.get('trades') or []:
            for k in ('ask_account_id', 'bid_account_id'):
                v = t.get(k)
                if isinstance(v, int) and v > 0:
                    vistas.add(v)
    return vistas


def serie(filas, puro=0.01):
    """Filas diarias de /api/v1/pnl -> {'valor': [(t, v)], 'pnl': [(t, p)]} o None si no es una cuenta de perpetuos pura."""
    if not filas:
        return None
    ult = filas[-1]
    entrada = float(ult.get('inflow') or 0)
    otros = sum(abs(float(ult.get(k) or 0)) for k in ('pool_inflow', 'pool_outflow', 'spot_inflow', 'spot_outflow', 'staking_inflow', 'staking_outflow'))
    if entrada <= 0 or otros > puro * entrada:
        return None
    valor, pnl = [], []
    for f in sorted(filas, key=lambda x: x['timestamp']):
        t = int(f['timestamp']) * 1000
        p = float(f.get('trade_pnl') or 0)
        v = float(f.get('inflow') or 0) - float(f.get('outflow') or 0) + p
        valor.append((t, v))
        pnl.append((t, p))
    return {'valor': valor, 'pnl': pnl}


def historial(idx, dias=420):
    fin = int(time.time())
    j = _get('/api/v1/pnl?by=index&value=%d&resolution=1d&start_timestamp=%d&end_timestamp=%d&count_back=%d' % (idx, fin - dias * 86400, fin, dias)) or {}
    return serie(j.get('pnl') or [])


def informe(r):
    l = ['# Aprender de los mejores en Lighter: ¿los que ganan siguen ganando?\n',
         '> Datos públicos de Lighter (operaciones recientes e historial diario de cada cuenta). Investigación en papel; no es una recomendación.\n',
         '- Generado: %s.' % r['generado'],
         '- Cuentas vistas operando hoy: %d (se estudian %d) y %d elegidas al azar entre los números de cuenta 1–%d.' % (r['activas_vistas'], r['activas'], r['azar'], r['maximo']),
         '- Historiales útiles (perpetuos puros): %d. Al menos %s $ al empezar cada mes.' % (r['historiales'], format(int(r['min_valor']), ',').replace(',', '.')),
         '- Diagnóstico: %s.\n' % json.dumps(r.get('diagnostico', {}), ensure_ascii=False)]
    e = r['estudio']
    if 'resumen' in e:
        s = e['resumen']
        l += ['## Resultado\n', '- Meses estudiados: %d.' % s['meses_estudiados'],
              '- Correlación entre el puesto de un mes y el del siguiente: **%.2f** de media (t = %.1f).' % (s['correlacion_media'], s['t_correlacion']),
              '- El 10 %% mejor de un mes rinde el mes siguiente **%+.2f puntos** frente al resto (t = %.1f); tiene ventaja en el %.0f %% de los meses.\n' % (s['ventaja_mejores_vs_resto_pct_mes'], s['t_ventaja'], s['meses_con_ventaja_pct']),
              '| Mes de elección | Cuentas | Correlación | 10 % mejor, mes siguiente | Resto, mes siguiente | 10 % mejor que gana | Resto que gana |',
              '|---|---|---|---|---|---|---|']
        for m in e['meses']:
            l.append('| %s | %d | %.2f | %+.2f %% | %+.2f %% | %.0f %% | %.0f %% |' % (m['mes_eleccion'], m['cuentas'], m['correlacion_rangos'], m['mejores_10pct_mes_siguiente_pct'], m['resto_mes_siguiente_pct'], m['mejores_10pct_ganan_siguiente_pct'], m['resto_ganan_siguiente_pct']))
    else:
        l.append('No hubo suficientes cuentas con historial para estudiar ningún mes (hacen falta 40 cuentas con al menos ese dinero en dos meses seguidos).')
    l.append('\nLas cuentas activas hoy son supervivientes (siguen operando); las elegidas al azar corrigen en parte ese sesgo. '
             'dYdX no se estudia: su API pública no da operaciones por cuenta ni ranking, y sin una lista de todas las cuentas solo se verían las ganadoras. '
             'La API de datos de Drift no respondía desde GitHub.')
    return '\n'.join(l) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='/tmp/lig')
    ap.add_argument('--activas', type=int, default=1200)
    ap.add_argument('--azar', type=int, default=600)
    ap.add_argument('--min-valor', type=float, default=10_000.0)
    a = ap.parse_args()
    t0 = time.time()
    ms = mercados()
    vistas = cuentas_activas(ms)
    principales = sorted(v for v in vistas if v < SUBCUENTA)
    maximo = max(principales) if principales else 1000
    rng = random.Random(11)
    activas = rng.sample(sorted(vistas), min(a.activas, len(vistas)))
    azar = rng.sample(range(1, maximo + 1), min(a.azar, maximo))
    historias = {}
    for idx in list(dict.fromkeys(activas + azar)):
        h = historial(idx)
        if h:
            historias[str(idx)] = h
    estudio = estudiar(historias, min_valor=a.min_valor)
    import numpy as np
    filas_n = [len(h['pnl']) for h in historias.values()]
    valores = [h['valor'][-1][1] for h in historias.values() if h['valor']]
    primeros = [h['pnl'][0][0] for h in historias.values() if h['pnl']]
    diag = {'filas_mediana': float(np.median(filas_n)) if filas_n else 0, 'filas_max': max(filas_n) if filas_n else 0,
            'primer_dia_mediana': dt.datetime.fromtimestamp(float(np.median(primeros)) / 1000, dt.timezone.utc).strftime('%Y-%m-%d') if primeros else None,
            'valor_hoy_p50': float(np.median(valores)) if valores else 0, 'valor_hoy_p90': float(np.quantile(valores, 0.9)) if valores else 0,
            'con_mas_de_min_valor_hoy': int(sum(v >= a.min_valor for v in valores))}
    res = {'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'mercados': len(ms),
           'activas_vistas': len(vistas), 'activas': len(activas), 'azar': len(azar), 'maximo': maximo,
           'historiales': len(historias), 'min_valor': a.min_valor, 'estudio': estudio, 'diagnostico': diag, 'segundos': round(time.time() - t0, 1)}
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'lighter.json'), 'w') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(res))
    print(json.dumps({k: res[k] for k in ('mercados', 'activas_vistas', 'historiales', 'segundos')}), json.dumps(estudio.get('resumen', {})))


if __name__ == '__main__':
    main()
