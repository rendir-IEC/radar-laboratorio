"""Universo de cada momento (D-I2 de la auditoría del laboratorio): sin sesgo de supervivencia.

En vez de probar sobre las monedas que hoy sabemos que sobrevivieron, cada mes se toman los perpetuos USDT-M que
Binance listaba entonces, incluidos los que después se retiraron (LUNA, FTT…), ordenados por el volumen del mes
anterior. Solo se usa lo que se sabía en cada momento.

Datos públicos de data.binance.vision: velas diarias y funding, en archivos mensuales (se guardan en caché).
Uso: python -m lab.universo --salida /tmp/uni [--tops 20 60]
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import time
import urllib.parse

import numpy as np
import pandas as pd

from .comun import COMISION, DESLIZAMIENTO
from .datos import _http, _leer_zip_csv, _meses, _ms, carpeta_datos

S3 = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
VISION = 'https://data.binance.vision/data/futures/um/monthly'
DESDE = dt.date(2020, 1, 1)
DIA = 86_400_000
# no son monedas: estables, índices y similares
EXCLUIR = {'USDCUSDT', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'USDPUSDT', 'DAIUSDT', 'EURUSDT', 'GBPUSDT', 'USDEUSDT',
           'USD1USDT', 'RLUSDUSDT', 'XUSDUSDT', 'PYUSDUSDT', 'BTCDOMUSDT', 'DEFIUSDT', 'BLUEBIRDUSDT', 'FOOTBALLUSDT'}
DIAS_MIN_MES = 20  # para entrar en el orden de un mes, al menos 20 días con datos el mes anterior


def es_moneda(sym):
    return sym.endswith('USDT') and '_' not in sym and sym not in EXCLUIR and 'DOM' not in sym[:-4]


def _xml_lista(xml):
    pref = re.findall(r'<CommonPrefixes>\s*<Prefix>([^<]+)</Prefix>\s*</CommonPrefixes>', xml)
    claves = re.findall(r'<Key>([^<]+)</Key>', xml)
    truncado = re.search(r'<IsTruncated>\s*true\s*</IsTruncated>', xml) is not None
    nm = re.search(r'<NextMarker>([^<]+)</NextMarker>', xml)
    return pref, claves, truncado, (nm.group(1) if nm else None)


def listar(prefijo):
    """Carpetas y archivos de data.binance.vision bajo un prefijo (con paginación)."""
    prefs, claves, marca = [], [], None
    for _ in range(50):
        url = '%s?delimiter=/&prefix=%s' % (S3, urllib.parse.quote(prefijo))
        if marca:
            url += '&marker=' + urllib.parse.quote(marca)
        estado, b = _http(url, intentos=5, timeout=60)
        if estado != 200 or not b:
            raise RuntimeError('No se pudo listar %s (%s)' % (prefijo, estado))
        p, k, truncado, siguiente = _xml_lista(b.decode('utf-8', 'replace'))
        prefs += p
        claves += k
        if not truncado:
            break
        marca = siguiente or (k[-1] if k else (p[-1] if p else None))
        if not marca:
            break
    return prefs, claves


def simbolos():
    prefs, _ = listar('data/futures/um/monthly/klines/')
    return sorted({p.rstrip('/').split('/')[-1] for p in prefs if es_moneda(p.rstrip('/').split('/')[-1])})


def meses_de(sym, tipo):
    if tipo == 'velas':
        _, k = listar('data/futures/um/monthly/klines/%s/1d/' % sym)
        patron = re.compile(r'%s-1d-(\d{4}-\d{2})\.zip$' % re.escape(sym))
    else:
        _, k = listar('data/futures/um/monthly/fundingRate/%s/' % sym)
        patron = re.compile(r'%s-fundingRate-(\d{4}-\d{2})\.zip$' % re.escape(sym))
    return sorted({m.group(1) for x in k for m in [patron.search(x)] if m})


def _bajar(ruta, url, tipo):
    estado, b = _http(url, intentos=4)
    if estado == 200 and b:
        filas = _leer_zip_csv(b)
        if tipo == 'f':  # calc_time, funding_interval_hours, last_funding_rate
            arr = np.array([[_ms(f[0]), float(f[2])] for f in filas if len(f) >= 3], dtype=np.float64)
        else:  # open_time, open, high, low, close, volume, close_time, quote_volume, count, taker_buy_volume, taker_buy_quote_volume
            arr = np.array([[_ms(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[4]), float(f[7]), float(f[10])]
                            for f in filas if len(f) >= 11], dtype=np.float64)
        np.save(ruta, arr)
    elif estado == 404:
        open(ruta + '.vacio', 'w').close()
    return estado


def descargar(hilos=16, registro=None):
    """Lista todos los perpetuos USDT-M (también los retirados) y baja sus velas diarias y su funding por meses."""
    registro = registro if registro is not None else {}
    base = os.path.join(carpeta_datos(), 'universo')
    os.makedirs(base, exist_ok=True)
    hoy = dt.datetime.now(dt.timezone.utc).date()
    ultimo = (hoy.replace(day=1) - dt.timedelta(days=1)).strftime('%Y-%m')  # último mes cerrado
    todos = set(_meses(DESDE, dt.date.fromisoformat(ultimo + '-01')))
    syms = simbolos()
    registro['simbolos'] = len(syms)

    def plan(sym):
        carpeta = os.path.join(base, sym)
        os.makedirs(carpeta, exist_ok=True)
        tareas = []
        for tipo, nombre in (('velas', 'd'), ('funding', 'f')):
            hechos = {f[2:9] for f in os.listdir(carpeta) if f.startswith(nombre + '_')}
            if todos - hechos == set():
                continue
            hay = meses_de(sym, tipo)
            for m in todos - hechos - set(hay):
                if m < ultimo:  # no existe ese mes: se anota para no volver a listarlo (el último puede publicarse tarde)
                    open(os.path.join(carpeta, '%s_%s.npy.vacio' % (nombre, m)), 'w').close()
            for m in hay:
                if m not in todos or m in hechos:
                    continue
                ruta = os.path.join(carpeta, '%s_%s.npy' % (nombre, m))
                if tipo == 'velas':
                    url = '%s/klines/%s/1d/%s-1d-%s.zip' % (VISION, sym, sym, m)
                else:
                    url = '%s/fundingRate/%s/%s-fundingRate-%s.zip' % (VISION, sym, sym, m)
                tareas.append((ruta, url, nombre))
        return tareas
    t0 = time.time()
    with cf.ThreadPoolExecutor(hilos) as ex:
        tareas = [t for ts in ex.map(plan, syms) for t in ts]
    registro['listado_s'] = round(time.time() - t0, 1)
    registro['descargas_pendientes'] = len(tareas)
    estados = {}
    t0 = time.time()
    with cf.ThreadPoolExecutor(hilos) as ex:
        for e in ex.map(lambda a: _bajar(*a), tareas):
            estados[e] = estados.get(e, 0) + 1
    registro['descargas'] = estados
    # el último mes cerrado puede no estar publicado aún aunque aparezca: se reintenta la próxima vez
    for sym in syms:
        for nombre in ('d', 'f'):
            r = os.path.join(base, sym, '%s_%s.npy.vacio' % (nombre, ultimo))
            if os.path.exists(r):
                os.remove(r)
    registro['descarga_s'] = round(time.time() - t0, 1)
    registro['ultimo_mes'] = ultimo
    return registro


def cargar(simbolos_=None):
    """Panel diario: {símbolo: DataFrame con open/high/low/close/vol/tb/f}, índice = día UTC."""
    base = os.path.join(carpeta_datos(), 'universo')
    out = {}
    for sym in sorted(simbolos_ or os.listdir(base)):
        carpeta = os.path.join(base, sym)
        if not os.path.isdir(carpeta):
            continue
        v = [np.load(os.path.join(carpeta, f)) for f in sorted(os.listdir(carpeta)) if f.startswith('d_') and f.endswith('.npy')]
        v = [x for x in v if x.ndim == 2 and x.shape[0]]
        if not v:
            continue
        v = np.concatenate(v)
        dia = pd.to_datetime((v[:, 0] // DIA) * DIA, unit='ms', utc=True)
        d = pd.DataFrame({'open': v[:, 1], 'high': v[:, 2], 'low': v[:, 3], 'close': v[:, 4], 'vol': v[:, 5], 'tb': v[:, 6]}, index=dia)
        d = d[~d.index.duplicated(keep='last')].sort_index()
        fu = [np.load(os.path.join(carpeta, f)) for f in sorted(os.listdir(carpeta)) if f.startswith('f_') and f.endswith('.npy')]
        fu = [x for x in fu if x.ndim == 2 and x.shape[0]]
        if fu:
            fu = np.concatenate(fu)
            # el funding que se cobra a las 00:00 corresponde a la posición del día anterior
            fd = pd.Series(fu[:, 1], index=pd.to_datetime(((fu[:, 0] - 1) // DIA) * DIA, unit='ms', utc=True)).groupby(level=0).sum()
            d['f'] = fd.reindex(d.index).fillna(0.0)
        else:
            d['f'] = 0.0
        # días seguidos: los huecos quedan en NaN (sin rellenar precios)
        d = d.reindex(pd.date_range(d.index[0], d.index[-1], freq='D', tz='UTC'))
        out[sym] = d
    return out


def rendimiento_siguiente(d, fin):
    """Lo que se gana si se entra al cierre de hoy y se sale al de mañana. Si la moneda deja de cotizar para siempre
    antes de `fin`, su último día cuenta 0 (se cierra al último precio) en vez de desaparecer: así el modelo no puede
    esquivar a las que mueren sabiendo que van a morir."""
    c = d['close']
    y = c.shift(-1) / c - 1
    ultimo = c.last_valid_index()
    if ultimo is not None and ultimo < fin:
        y.loc[ultimo] = 0.0
    return y


def pertenencia(dd, top, fin=None):
    """Para cada símbolo, los días en que está entre los `top` de más volumen del mes anterior (sin mirar al futuro)."""
    vols = {}
    for s, d in dd.items():
        g = d['vol'].groupby(d.index.tz_localize(None).to_period('M'))
        vols[s] = pd.DataFrame({'v': g.sum(min_count=1), 'n': g.count()})
    meses = sorted({m for x in vols.values() for m in x.index})
    miembros = {s: pd.Series(False, index=d.index) for s, d in dd.items()}
    orden_mes = {}
    for m in meses[1:]:
        previo = m - 1
        cand = [(x.loc[previo, 'v'], s) for s, x in vols.items() if previo in x.index and x.loc[previo, 'n'] >= DIAS_MIN_MES and x.loc[previo, 'v'] > 0]
        elegidos = [s for _, s in sorted(cand, reverse=True)[:top]]
        orden_mes[str(m)] = elegidos
        for s in elegidos:
            d = dd[s]
            dias = (d.index.tz_localize(None).to_period('M') == m) & d['close'].notna().values
            miembros[s] = miembros[s] | pd.Series(dias, index=d.index)
    return miembros, orden_mes


def resumen_universo(orden_mes, dd):
    """Cuántos símbolos distintos pasan por el universo y cuántos de ellos ya no cotizan."""
    vistos = sorted({s for v in orden_mes.values() for s in v})
    fin = max(d.index[-1] for d in dd.values())
    muertos = [s for s in vistos if dd[s]['close'].last_valid_index() < fin - pd.Timedelta(days=7)]
    return {'distintos': len(vistos), 'ya_no_cotizan': len(muertos), 'ejemplos_retirados': muertos[:25]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='/tmp/uni')
    ap.add_argument('--tops', type=int, nargs='+', default=[20, 60])
    ap.add_argument('--sin-descarga', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.salida, exist_ok=True)
    registro = {} if a.sin_descarga else descargar()
    dd = cargar()
    if 'BTCUSDT' not in dd:
        raise SystemExit('Falta BTCUSDT')
    from .ml import evaluar_dd, informe
    fin = max(d.index[-1] for d in dd.values())
    for d in dd.values():
        d['y'] = rendimiento_siguiente(d, fin)
    coste = COMISION + DESLIZAMIENTO
    out = {'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'coste_por_giro_pct': round(coste * 100, 3),
           'registro': registro, 'simbolos_con_datos': len(dd), 'universos': {}, 'resultados': []}
    for top in a.tops:
        miembros, orden_mes = pertenencia(dd, top)
        out['universos'][str(top)] = dict(resumen_universo(orden_mes, dd), ultimo_mes=orden_mes[max(orden_mes)][:top] if orden_mes else [])
        sub = {s: d for s, d in dd.items() if s == 'BTCUSDT' or miembros[s].any()}  # solo las que alguna vez entran
        r = evaluar_dd(sub, miembros, 'cada momento, las %d de más volumen' % top, coste, btc='BTCUSDT')
        r['monedas'] = top
        out['resultados'].append(r)
        print(json.dumps({'top': top, 'ic': r['ic_medio'], 't': r['t_ic'], 's': r['segundos']}), flush=True)
    with open(os.path.join(a.salida, 'universo.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1, default=str)
    texto = informe(out, titulo='Aprendizaje automático sobre el universo de cada momento (sin sesgo de supervivencia)',
                    nota='Universo de cada momento: cada mes, los perpetuos USDT-M de Binance con más volumen el mes anterior, incluidos los que después se retiraron (su último día cuenta como cierre al último precio). Velas diarias de Binance. 8 variantes de cartera fijadas de antemano.')
    u = ['\n## Universos\n', 'Símbolos USDT-M con datos (incluidos los retirados): %d.' % len(dd)]
    for top, v in out['universos'].items():
        u.append('- Las %s de más volumen cada mes: pasan %d símbolos distintos; %d ya no cotizan (p. ej. %s).' % (
            top, v['distintos'], v['ya_no_cotizan'], ', '.join(v['ejemplos_retirados'][:10]) or '—'))
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(texto + '\n'.join(u) + '\n')


if __name__ == '__main__':
    main()
