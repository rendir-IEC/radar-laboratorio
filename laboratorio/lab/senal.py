"""Señal diaria del aprendizaje automático para el servidor (un experto más, en papel y con poco peso).

Cada día, cuando Binance ha publicado las velas del día anterior:
1. Universo de cada momento: las 20 de más volumen del mes anterior, sin oro, petróleo ni acciones (lab/universo.py).
2. Datos: archivos mensuales (en caché) y diarios del mes en curso de data.binance.vision. El funding del mes en curso
   no tiene archivos diarios: se toma de Hyperliquid para las monedas que lista (mismo signo y orden de magnitud).
3. Modelo: el mismo LightGBM de la prueba (lab/ml.py), entrenado con todos los días cuyo resultado ya se conoce.
4. Cartera: la versión robusta de la prueba («lenta largo-corto k5»): compra las 5 de mejor predicción y vende las 5
   peores entre las monedas que el servidor sabe operar; una moneda se mantiene mientras siga entre las 15 mejores
   (o peores). Para eso recuerda la cartera anterior, que lee de la señal ya publicada.

Uso: python -m lab.senal --salida /tmp/sen [--anterior ../resultados/ml/senal.json]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import math
import os
import time

import numpy as np
import pandas as pd

from .comun import MONEDAS_SERVIDOR
from .datos import _http, _leer_zip_csv, _ms, carpeta_datos, hl
from .ml import _elegir, entrenar, preparar_dd
from .universo import DIA, VISION, descargar, no_cripto, pertenencia, rendimiento_siguiente

TOP = 20
K = 5
SALIDA = 15
PESO = 0.5 / K          # como en la prueba: la mitad del dinero comprado y la mitad vendido
VISION_DIARIO = VISION.replace('/monthly', '/daily')


def a_servidor(sym):
    """'BTCUSDT' -> 'BTC'; '1000PEPEUSDT' -> 'kPEPE' (así lo llama Hyperliquid). None si no termina en USDT."""
    if not sym.endswith('USDT'):
        return None
    b = sym[:-4]
    return 'k' + b[4:] if b.startswith('1000') and len(b) > 4 else b


def _bajar_dia(ruta, url):
    estado, b = _http(url, intentos=4)
    if estado == 200 and b:
        filas = _leer_zip_csv(b)
        arr = np.array([[_ms(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[4]), float(f[7]), float(f[10])]
                        for f in filas if len(f) >= 11], dtype=np.float64)
        np.save(ruta, arr)
    return estado


def descargar_diarios(simbolos, desde, hasta, hilos=16):
    """Velas diarias (un archivo por día) de `desde` a `hasta` (incluidos) para los símbolos dados, con caché.
    Un día que aún no está publicado no se marca: se vuelve a pedir la próxima vez."""
    base = os.path.join(carpeta_datos(), 'universo')
    tareas = []
    for s in simbolos:
        os.makedirs(os.path.join(base, s), exist_ok=True)
        d = desde
        while d <= hasta:
            ruta = os.path.join(base, s, 'dia_%s.npy' % d.isoformat())
            mes = os.path.join(base, s, 'd_%s.npy' % d.strftime('%Y-%m'))
            if not os.path.exists(ruta) and not os.path.exists(mes):
                tareas.append((ruta, '%s/klines/%s/1d/%s-1d-%s.zip' % (VISION_DIARIO, s, s, d.isoformat())))
            d += dt.timedelta(days=1)
    estados = {}
    with cf.ThreadPoolExecutor(hilos) as ex:
        for e in ex.map(lambda a: _bajar_dia(*a), tareas):
            estados[e] = estados.get(e, 0) + 1
    return {'pedidos': len(tareas), 'estados': estados}


def funding_hl(coins, desde_ms, hasta_ms):
    """Funding diario (suma de las tasas horarias) de Hyperliquid, con el mismo convenio de días que Binance:
    lo que se cobra a las 00:00 es de la posición del día anterior."""
    out = {}
    for c in coins:
        filas, t0 = [], desde_ms
        for _ in range(4):
            r = hl({'type': 'fundingHistory', 'coin': c, 'startTime': t0, 'endTime': hasta_ms}, peso=45)
            if not r:
                break
            filas += [(int(x['time']), float(x['fundingRate'])) for x in r]
            if len(r) < 500:
                break
            t0 = int(r[-1]['time']) + 1
        if filas:
            s = pd.Series([f for _, f in filas], index=pd.to_datetime([((t - 1) // DIA) * DIA for t, _ in filas], unit='ms', utc=True))
            out[c] = s.groupby(level=0).sum()
    return out


def top_por_volumen(dd, dia, n):
    """Los n símbolos con más volumen en el mes del día dado (al menos 20 días con datos)."""
    mes = dia.tz_localize(None).to_period('M')
    v = []
    for s, x in dd.items():
        m = x[x.index.tz_localize(None).to_period('M') == mes]
        if m['close'].notna().sum() >= 20 and m['vol'].sum() > 0:
            v.append((m['vol'].sum(), s))
    return [s for _, s in sorted(v, reverse=True)[:n]]


def cartera_nueva(pred, operables, anterior):
    """pred: Serie {símbolo: puntuación} del día. Devuelve {moneda del servidor: peso} (±PESO) con banda."""
    x = pred[[s for s in pred.index if a_servidor(s) in operables]].sort_values()
    orden = list(x.index)
    previo = {s: w for s, w in (anterior or {}).items()}
    tenidos_l = {s for s in orden if previo.get(a_servidor(s), 0) > 0}
    tenidos_c = {s for s in orden if previo.get(a_servidor(s), 0) < 0}
    if len(orden) < 2 * K:
        return {}
    w = {}
    for s in _elegir(orden[::-1], K, SALIDA, tenidos_l):
        w[a_servidor(s)] = PESO
    for s in _elegir(orden, K, SALIDA, tenidos_c):
        if a_servidor(s) not in w:
            w[a_servidor(s)] = -PESO
    return w


def calcular(dd, anterior=None, hoy=None, operables=MONEDAS_SERVIDOR):
    """Con el panel diario ya cargado: entrena, predice el último día cerrado y devuelve la señal."""
    hoy = hoy or pd.Timestamp.now(tz='UTC').normalize()
    fuera = no_cripto(dd)
    dd = {s: d for s, d in dd.items() if s not in fuera}
    # último día cerrado con velas para BTC (el día d termina a las 00:00 de d+1)
    btc = dd['BTCUSDT']['close'].dropna()
    d = btc.index[-1]
    if d >= hoy:
        d = btc.index[btc.index < hoy][-1]
    fin = d
    miembros, orden_mes = pertenencia(dd, TOP)
    mes = d.tz_localize(None).to_period('M')
    hoy_miembros = sorted(s for s, m in miembros.items() if d in m.index and m.loc[d])
    for x in dd.values():
        x['y'] = rendimiento_siguiente(x, fin)
    sub = {s: x for s, x in dd.items() if s == 'BTCUSDT' or miembros[s].any()}
    df, Xn, yn, feats = preparar_dd(sub, miembros, btc='BTCUSDT')
    dias = df.index.get_level_values(0)
    entreno = (dias < d) & yn.notna().values
    modelo = entrenar(Xn[entreno], yn[entreno], 7)
    hoy_x = dias == d
    if not hoy_x.any():
        raise SystemExit('Sin monedas del universo el %s' % d.date())
    pred = pd.Series(modelo.predict(Xn[hoy_x]), index=df.index[hoy_x].get_level_values(1))
    w = cartera_nueva(pred, set(operables), (anterior or {}).get('cartera'))
    orden = pred.sort_values(ascending=False)
    return {
        'version': 1,
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'fecha': str(d.date()),                       # cierre usado (00:00 UTC del día siguiente)
        'valida_hasta': str((d + pd.Timedelta(days=3)).date()),
        'modelo': 'LightGBM, %d indicadores (Alpha158 de Qlib + funding, compras agresivas y beta con BTC)' % len(feats),
        'regla': 'lenta largo-corto: compra las %d mejores y vende las %d peores entre las monedas del servidor; se mantienen mientras sigan entre las %d mejores (o peores); %.0f %% del dinero en cada una' % (K, K, SALIDA, PESO * 100),
        'universo_mes': str(mes), 'universo': [s for s in orden_mes.get(str(mes), [])],
        'dias_de_entrenamiento': int(pd.Index(dias[entreno]).nunique()), 'filas_de_entrenamiento': int(entreno.sum()),
        'ranking': [{'simbolo': s, 'moneda': a_servidor(s), 'operable': a_servidor(s) in set(operables), 'puntuacion': round(float(v), 5)} for s, v in orden.items()],
        'cartera': w,
        'anterior': (anterior or {}).get('cartera'),
        'fuera_no_cripto': len(fuera),
        'aviso': 'Investigación en papel. En la prueba de 2022 a 2026: +21 % al año de media con caídas del 37 %, y 2026 en negativo. No es una recomendación.',
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='/tmp/sen')
    ap.add_argument('--anterior', default=os.path.join('..', 'resultados', 'ml', 'senal.json'))
    a = ap.parse_args()
    os.makedirs(a.salida, exist_ok=True)
    t0 = time.time()
    registro = descargar()  # mensuales (solo lo nuevo)
    from .universo import cargar
    dd = cargar()
    hoy = pd.Timestamp.now(tz='UTC').normalize()
    ayer = hoy - pd.Timedelta(days=1)
    mes_previo = (ayer.replace(day=1) - pd.Timedelta(days=1))
    cripto = {s: x for s, x in dd.items() if s not in set(no_cripto(dd))}
    # candidatas para el mes en curso: las de más volumen del mes pasado (con margen) y BTC. Si el mensual del mes
    # pasado aún no está publicado, el orden sale del mes anterior y se bajan los diarios del mes pasado.
    candidatos = top_por_volumen(cripto, mes_previo, TOP + 10)
    if len(candidatos) < TOP:
        candidatos = top_por_volumen(cripto, mes_previo.replace(day=1) - pd.Timedelta(days=1), TOP + 10)
    candidatos = set(candidatos) | {'BTCUSDT'}
    desde = mes_previo.replace(day=1).date()
    registro['diarios'] = descargar_diarios(sorted(candidatos), desde, ayer.date())
    dd = cargar()
    # funding que Binance aún no ha publicado (solo da archivos mensuales): el de Hyperliquid
    huecos = [dd[s].index[(dd[s].index >= pd.Timestamp(desde, tz='UTC')) & dd[s]['f'].isna().values] for s in candidatos if s in dd]
    huecos = [h for h in huecos if len(h)]
    if huecos:
        desde_ms = int(min(h[0] for h in huecos).timestamp() * 1000)
        coins = {s: a_servidor(s) for s in candidatos if a_servidor(s)}
        fhl = funding_hl(sorted(set(coins.values())), desde_ms, int(hoy.timestamp() * 1000) + DIA)
        registro['funding_hyperliquid'] = sorted(fhl)
        for s, c in coins.items():
            if s in dd and c in fhl:
                f = dd[s]['f']
                dd[s]['f'] = f.where(f.notna(), fhl[c].reindex(f.index))
    try:
        anterior = json.load(open(a.anterior))
    except (OSError, ValueError):
        anterior = None
    r = calcular(dd, anterior, hoy)
    r['registro'] = registro
    r['segundos'] = round(time.time() - t0, 1)
    with open(os.path.join(a.salida, 'senal.json'), 'w') as f:
        json.dump(r, f, ensure_ascii=False, indent=1, default=str)
    print(json.dumps({k: r[k] for k in ('fecha', 'cartera', 'universo_mes', 'segundos')}, ensure_ascii=False))
    if not r['cartera']:
        raise SystemExit('Cartera vacía: revisar')


if __name__ == '__main__':
    main()
