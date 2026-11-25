"""Dónde está la ventaja esta semana: unos 25 mercados ordenados por su tendencia reciente, con su historial.

Regla fijada antes de mirar resultados (no se optimiza):
- Cada viernes al cierre, para cada mercado: rendimiento de las últimas 12 semanas y volatilidad semanal de las últimas 26.
- Puntuación = rendimiento de 12 semanas / (volatilidad semanal × raíz de 12): la tendencia medida en «sigmas».
  Al alza si es positiva, a la baja si es negativa (la «tendencia de series temporales» de Moskowitz, Ooi y Pedersen, 2012).
- Se mantiene una semana y se vuelve a mirar.
Se prueba: (1) en cada mercado, seguir la señal al alza y a la baja; (2) solo comprando (o en efectivo), que es lo que se
puede hacer en un bróker como MyInvestor; (3) cada semana, las 3 de mayor puntuación positiva a partes iguales, frente a
tenerlas todas a partes iguales y frente a solo Bitcoin. Coste: 0,10 % por cada compra o venta.

Datos: cierres diarios públicos (Yahoo Finance; si falla, Stooq). Solo se publican resultados, no los datos.
Uso: python -m lab.semana --salida ../resultados/semana
"""
import argparse
import csv
import datetime as dt
import io
import json
import math
import os
import time
import urllib.error
import urllib.request

import numpy as np
import pandas as pd

MERCADOS = [
    # (símbolo en el panel, nombre, clase, Yahoo, Stooq, cómo se compraría)
    ('BTC', 'Bitcoin', 'cripto', 'BTC-USD', 'btcusd', 'ETP de Bitcoin (MyInvestor) o Kraken'),
    ('ETH', 'Ethereum', 'cripto', 'ETH-USD', 'ethusd', 'ETP de Ethereum (MyInvestor) o Kraken'),
    ('SOL', 'Solana', 'cripto', 'SOL-USD', None, 'ETP de Solana o Kraken'),
    ('XRP', 'XRP', 'cripto', 'XRP-USD', None, 'ETP de XRP o Kraken'),
    ('BNB', 'BNB', 'cripto', 'BNB-USD', None, 'Kraken'),
    ('DOGE', 'Dogecoin', 'cripto', 'DOGE-USD', None, 'Kraken'),
    ('ADA', 'Cardano', 'cripto', 'ADA-USD', None, 'ETP de Cardano o Kraken'),
    ('LINK', 'Chainlink', 'cripto', 'LINK-USD', None, 'Kraken'),
    ('AVAX', 'Avalanche', 'cripto', 'AVAX-USD', None, 'Kraken'),
    ('LTC', 'Litecoin', 'cripto', 'LTC-USD', None, 'Kraken'),
    ('ORO', 'Oro', 'materias primas', 'GLD', 'gld.us', 'ETC de oro físico'),
    ('PLATA', 'Plata', 'materias primas', 'SLV', 'slv.us', 'ETC de plata'),
    ('WTI', 'Petróleo WTI', 'materias primas', 'USO', 'uso.us', 'ETC de petróleo'),
    ('BRENT', 'Petróleo Brent', 'materias primas', 'BNO', 'bno.us', 'ETC de Brent'),
    ('GAS', 'Gas natural', 'materias primas', 'UNG', 'ung.us', 'ETC de gas natural'),
    ('COBRE', 'Cobre', 'materias primas', 'CPER', 'cper.us', 'ETC de cobre'),
    ('SP500', 'S&P 500', 'índices', 'SPY', 'spy.us', 'ETF o fondo indexado del S&P 500'),
    ('NASDAQ100', 'Nasdaq 100', 'índices', 'QQQ', 'qqq.us', 'ETF del Nasdaq 100'),
    ('DAX', 'DAX alemán', 'índices', '^GDAXI', '^dax', 'ETF del DAX'),
    ('EUROSTOXX50', 'Euro Stoxx 50', 'índices', '^STOXX50E', '^stx', 'ETF del Euro Stoxx 50'),
    ('NIKKEI', 'Nikkei 225', 'índices', '^N225', '^nkx', 'ETF del Nikkei'),
    ('BONOS', 'Bonos de EE. UU. a 20 años', 'bonos', 'TLT', 'tlt.us', 'ETF de bonos largos de EE. UU.'),
    ('EURUSD', 'Euro / dólar', 'divisas', 'EURUSD=X', 'eurusd', 'Divisa (cuenta en dólares o CFD)'),
    ('USDJPY', 'Dólar / yen', 'divisas', 'USDJPY=X', 'usdjpy', 'Divisa'),
    ('GBPUSD', 'Libra / dólar', 'divisas', 'GBPUSD=X', 'gbpusd', 'Divisa'),
]
SEMANAS_TENDENCIA = 12
SEMANAS_VOL = 26
COSTE = 0.001          # por cada compra o venta
TOP = 3
UA = {'User-Agent': 'Mozilla/5.0 (radar-laboratorio; investigación)'}


def _get(url, intentos=4, timeout=40):
    for i in range(intentos):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404):
                return e.code, b''
        except Exception:
            pass
        time.sleep(2 * (i + 1))
    return -1, b''


def yahoo(sim):
    url = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=0&period2=%d&interval=1d&includeAdjustedClose=true' % (
        urllib.request.quote(sim, safe=''), int(time.time()) + 86400)
    st, b = _get(url)
    if st != 200:
        return None, 'yahoo %s' % st
    try:
        r = json.loads(b)['chart']['result'][0]
        ts = r['timestamp']
        q = r['indicators']
        cierre = (q.get('adjclose') or [{}])[0].get('adjclose') or q['quote'][0]['close']
        s = pd.Series(cierre, index=pd.to_datetime(ts, unit='s', utc=True).normalize(), dtype=float).dropna()
        s = s[~s.index.duplicated(keep='last')]
        return (s if len(s) > 200 else None), 'yahoo'
    except Exception as e:  # formato inesperado
        return None, 'yahoo formato: %s' % type(e).__name__


def stooq(sim):
    if not sim:
        return None, 'stooq sin símbolo'
    st, b = _get('https://stooq.com/q/d/l/?s=%s&i=d' % urllib.request.quote(sim, safe=''))
    if st != 200 or not b or b[:4] != b'Date':
        return None, 'stooq %s' % st
    filas = list(csv.DictReader(io.StringIO(b.decode('utf-8', 'replace'))))
    try:
        s = pd.Series([float(f['Close']) for f in filas], index=pd.to_datetime([f['Date'] for f in filas], utc=True), dtype=float).dropna()
        return (s if len(s) > 200 else None), 'stooq'
    except (KeyError, ValueError):
        return None, 'stooq formato'


def descargar():
    series, fuentes = {}, {}
    for sim, nombre, clase, y, s, _ in MERCADOS:
        serie, fuente = yahoo(y)
        if serie is None:
            serie, f2 = stooq(s)
            fuente = fuente + ' → ' + f2
        fuentes[sim] = fuente
        if serie is not None:
            series[sim] = serie
        time.sleep(0.5)
    return series, fuentes


def semanal(series):
    """Cierres de cada viernes (el último cierre disponible de esa semana), alineados en una tabla."""
    sem = {k: v.resample('W-FRI').last() for k, v in series.items()}
    return pd.DataFrame(sem).sort_index()


def senales(P):
    """Puntuación de tendencia de cada mercado en cada viernes, con lo que se sabía ese viernes."""
    r = np.log(P).diff()
    vol = r.rolling(SEMANAS_VOL, min_periods=SEMANAS_VOL).std()
    r12 = P / P.shift(SEMANAS_TENDENCIA) - 1
    punt = np.log(P / P.shift(SEMANAS_TENDENCIA)) / (vol * math.sqrt(SEMANAS_TENDENCIA))
    return r12, vol, punt


def _stats(x, por_ano=52):
    x = pd.Series(x).dropna()
    if len(x) < 10:
        return None
    eq = (1 + x).cumprod()
    caida = float((eq / eq.cummax() - 1).min())
    anos = len(x) / por_ano
    m, sd = float(x.mean()), float(x.std(ddof=1))
    return {
        'semanas': int(len(x)), 'positivasPct': round(float((x > 0).mean()) * 100, 1),
        'mediaSemanaPct': round(m * 100, 3), 't': round(m / (sd / math.sqrt(len(x))), 2) if sd > 0 else 0.0,
        'anualPct': round((float(eq.iloc[-1]) ** (1 / anos) - 1) * 100, 1) if anos > 0 and eq.iloc[-1] > 0 else -100.0,
        'volAnualPct': round(sd * math.sqrt(por_ano) * 100, 1), 'sharpe': round(m / sd * math.sqrt(por_ano), 2) if sd > 0 else 0.0,
        'caidaMaxPct': round(caida * 100, 1), 'peorSemanaPct': round(float(x.min()) * 100, 2), 'mejorSemanaPct': round(float(x.max()) * 100, 2),
    }


def estudiar(P):
    r12, vol, punt = senales(P)
    sig = P.shift(-1) / P - 1                      # rendimiento de la semana siguiente
    direc = np.sign(punt)                          # +1 al alza, −1 a la baja
    largo = (punt > 0).astype(float).where(punt.notna())
    # coste: al cambiar de posición (de +1 a −1 son dos operaciones)
    ls = direc * sig - COSTE * direc.diff().abs().fillna(direc.abs())
    lo = largo * sig - COSTE * largo.diff().abs().fillna(largo)
    por_mercado = {}
    for c in P.columns:
        a, b = ls[c].where(punt[c].notna() & sig[c].notna()), lo[c].where(punt[c].notna() & sig[c].notna())
        dentro = b[largo[c] > 0]
        por_mercado[c] = {
            'alzaYBaja': _stats(a), 'soloCompras': _stats(b), 'comprarYMantener': _stats(sig[c].where(punt[c].notna())),
            'aciertoPct': round(float(((direc[c] * sig[c]) > 0)[punt[c].notna() & sig[c].notna()].mean()) * 100, 1) if punt[c].notna().any() else None,
            'cuandoAlAlzaMediaPct': round(float(sig[c][largo[c] > 0].mean()) * 100, 3) if (largo[c] > 0).any() else None,
            'cuandoAlaBajaMediaPct': round(float(sig[c][(largo[c] == 0) & punt[c].notna()].mean()) * 100, 3) if ((largo[c] == 0) & punt[c].notna()).any() else None,
            'desde': str(punt[c].first_valid_index().date()) if punt[c].first_valid_index() is not None else None,
            'semanasEnCompra': int(len(dentro)),
        }
    # cartera: cada viernes, las TOP de mayor puntuación positiva, a partes iguales (el resto, en efectivo)
    pesos = pd.DataFrame(0.0, index=P.index, columns=P.columns)
    for t in P.index:
        p = punt.loc[t].dropna()
        p = p[p > 0].sort_values(ascending=False).head(TOP)
        for c in p.index:
            pesos.loc[t, c] = 1.0 / TOP
    hay = punt.notna().sum(axis=1) >= 8            # solo desde que hay al menos 8 mercados con señal
    giro = pesos.diff().abs().sum(axis=1).fillna(pesos.sum(axis=1))
    top = (pesos * sig.fillna(0)).sum(axis=1) - COSTE * giro
    todos_w = punt.notna().astype(float).div(punt.notna().sum(axis=1).replace(0, np.nan), axis=0)
    todos = (todos_w * sig.fillna(0)).sum(axis=1)
    validas = hay & sig.notna().any(axis=1)
    validas.iloc[-1] = False                       # la última semana aún no tiene resultado
    ult = validas[validas].index[-104:] if validas.any() else []
    cart = {
        'top3': _stats(top[validas]), 'top3UltimosDosAnos': _stats(top[ult]) if len(ult) else None,
        'todosIgual': _stats(todos[validas]), 'todosIgualUltimosDosAnos': _stats(todos[ult]) if len(ult) else None,
        'bitcoin': _stats(sig['BTC'][validas]) if 'BTC' in sig else None,
        'bitcoinUltimosDosAnos': _stats(sig['BTC'][ult]) if 'BTC' in sig and len(ult) else None,
        'desde': str(validas[validas].index[0].date()) if validas.any() else None,
        'semanasEnEfectivoPct': round(float((pesos[validas].sum(axis=1) < 0.99).mean()) * 100, 1) if validas.any() else None,
    }
    # resumen de la regla en todos los mercados juntos (cada mercado-semana cuenta una vez)
    todas_ls = ls.where(punt.notna() & sig.notna()).stack().dropna()
    todas_lo = lo.where(punt.notna() & sig.notna()).stack().dropna()
    global_ = {'alzaYBaja': _stats(todas_ls), 'soloCompras': _stats(todas_lo),
               'aciertoPct': round(float((todas_ls > 0).mean()) * 100, 1) if len(todas_ls) else None}
    return r12, vol, punt, por_mercado, cart, global_, top[validas], pesos


def hoy(series, por_mercado):
    """La señal con el último cierre de cada mercado (no hace falta esperar al viernes)."""
    filas = []
    for sim, nombre, clase, *_, como in MERCADOS:
        s = series.get(sim)
        if s is None or len(s) < 200:
            continue
        w = s.resample('W-FRI').last()
        w.iloc[-1] = s.iloc[-1]
        r = np.log(w).diff()
        vol = float(r.iloc[-SEMANAS_VOL:].std())
        if not (vol > 0) or len(w) <= SEMANAS_TENDENCIA:
            continue
        p12 = float(w.iloc[-1] / w.iloc[-1 - SEMANAS_TENDENCIA] - 1)
        punt = math.log(1 + p12) / (vol * math.sqrt(SEMANAS_TENDENCIA))
        h = por_mercado.get(sim, {})
        ls, lo = h.get('alzaYBaja') or {}, h.get('soloCompras') or {}
        filas.append({
            'simbolo': sim, 'nombre': nombre, 'clase': clase, 'comoComprar': como, 'cierre': str(s.index[-1].date()), 'precio': round(float(s.iloc[-1]), 6),
            'rend12SemPct': round(p12 * 100, 2), 'volSemanalPct': round(vol * 100, 2), 'puntuacion': round(punt, 2),
            'direccion': 'al alza' if punt > 0 else 'a la baja',
            'aciertoPct': h.get('aciertoPct'), 'mediaSemanaPct': ls.get('mediaSemanaPct'), 'tSenal': ls.get('t'), 'anualSenalPct': ls.get('anualPct'),
            'soloComprasAnualPct': lo.get('anualPct'), 'soloComprasCaidaMaxPct': lo.get('caidaMaxPct'),
            'mantenerAnualPct': (h.get('comprarYMantener') or {}).get('anualPct'),
            'cuandoAlAlzaMediaPct': h.get('cuandoAlAlzaMediaPct'), 'cuandoAlaBajaMediaPct': h.get('cuandoAlaBajaMediaPct'),
            'semanas': ls.get('semanas'), 'desde': h.get('desde'),
        })
    filas.sort(key=lambda f: -f['puntuacion'])
    positivos = [f for f in filas if f['puntuacion'] > 0][:TOP]
    for i, f in enumerate(filas):
        f['puesto'] = i + 1
        f['enTop3'] = f in positivos
    return filas


def informe(res):
    c, g = res['cartera'], res['global']
    def fila(nombre, s):
        if not s:
            return '| %s | — | — | — | — | — |' % nombre
        return '| %s | %d | %.1f %% | %+.2f %% (t = %.1f) | %+.1f %% | %.1f %% |' % (nombre, s['semanas'], s['positivasPct'], s['mediaSemanaPct'], s['t'], s['anualPct'], s['caidaMaxPct'])
    l = ['# Dónde está la ventaja esta semana\n', '> Investigación en papel con cierres diarios públicos; no es una recomendación.\n',
         '- Generado: %s. Mercados con datos: %d de %d.' % (res['generado'], len(res['hoy']), len(MERCADOS)),
         '- Regla (fijada antes de mirar): tendencia de 12 semanas dividida por la volatilidad; se mantiene una semana. Coste 0,10 % por operación.\n',
         '## ¿Funciona?\n', '| Qué | Semanas | Semanas en positivo | Media por semana | Al año | Caída máxima |', '|---|---|---|---|---|---|',
         fila('Las 3 mejores cada semana (desde %s)' % c.get('desde'), c.get('top3')), fila('Las 3 mejores, últimos 2 años', c.get('top3UltimosDosAnos')),
         fila('Todas a partes iguales', c.get('todosIgual')), fila('Todas, últimos 2 años', c.get('todosIgualUltimosDosAnos')),
         fila('Solo Bitcoin', c.get('bitcoin')), fila('Solo Bitcoin, últimos 2 años', c.get('bitcoinUltimosDosAnos')),
         fila('Regla al alza y a la baja, todos los mercados juntos', g.get('alzaYBaja')), fila('Regla solo comprando, todos juntos', g.get('soloCompras')),
         '\nAcierto de la dirección, todos juntos: %s %%. Semanas de la cartera con parte en efectivo: %s %%.\n' % (g.get('aciertoPct'), c.get('semanasEnEfectivoPct')),
         '## Esta semana\n', '| Puesto | Mercado | Señal | Puntuación | 12 semanas | Acierto histórico | Media por semana siguiendo la señal | Desde |', '|---|---|---|---|---|---|---|---|']
    for f in res['hoy']:
        l.append('| %d%s | %s | %s | %.2f | %+.1f %% | %s %% | %s %% | %s |' % (f['puesto'], ' ★' if f['enTop3'] else '', f['nombre'], f['direccion'], f['puntuacion'], f['rend12SemPct'],
                                                                     f['aciertoPct'], f['mediaSemanaPct'], f['desde']))
    l.append('\nFuentes: ' + ', '.join('%s: %s' % (k, v) for k, v in res['fuentes'].items()))
    return '\n'.join(l) + '\n'


def limpio(o):
    """JSON válido: sin NaN ni infinitos (el navegador y el servidor no los aceptan)."""
    if isinstance(o, dict):
        return {k: limpio(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [limpio(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return float(o) if math.isfinite(o) else None
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='../resultados/semana')
    a = ap.parse_args()
    series, fuentes = descargar()
    P = semanal(series)
    P = P.iloc[:-1] if len(P) and P.index[-1] > pd.Timestamp.now(tz='UTC') else P   # la semana en curso no cuenta en la historia
    r12, vol, punt, por_mercado, cart, global_, serie_top, pesos = estudiar(P)
    res = {'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'regla': {'semanasTendencia': SEMANAS_TENDENCIA, 'semanasVol': SEMANAS_VOL, 'coste': COSTE, 'top': TOP},
           'fuentes': fuentes, 'cartera': cart, 'global': global_, 'porMercado': por_mercado, 'hoy': hoy(series, por_mercado),
           'ultimasSemanasTop3': [{'semana': str(t.date()), 'resultadoPct': round(float(v) * 100, 2)} for t, v in serie_top.tail(12).items()]}
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'semana.json'), 'w') as f:
        json.dump(limpio(res), f, ensure_ascii=False, indent=1, allow_nan=False, default=lambda o: None)
    # lo que lee el servidor: pequeño y estable
    ranking = {'version': 1, 'generado': res['generado'], 'regla': 'Tendencia de 12 semanas / volatilidad; una semana; 0,10 % por operación',
               'cartera': {k: cart.get(k) for k in ('desde', 'top3', 'top3UltimosDosAnos', 'todosIgual', 'bitcoin')},
               'global': global_,
               'mercados': [{k: f[k] for k in ('puesto', 'simbolo', 'nombre', 'clase', 'comoComprar', 'cierre', 'rend12SemPct', 'volSemanalPct', 'puntuacion', 'direccion',
                                                  'aciertoPct', 'mediaSemanaPct', 'tSenal', 'soloComprasAnualPct', 'soloComprasCaidaMaxPct', 'mantenerAnualPct', 'cuandoAlAlzaMediaPct', 'cuandoAlaBajaMediaPct', 'semanas', 'desde', 'enTop3')} for f in res['hoy']]}
    with open(os.path.join(a.salida, 'ranking.json'), 'w') as f:
        json.dump(limpio(ranking), f, ensure_ascii=False, indent=1, allow_nan=False, default=lambda o: None)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(limpio(res)))
    print(informe(limpio(res)))


if __name__ == '__main__':
    main()
