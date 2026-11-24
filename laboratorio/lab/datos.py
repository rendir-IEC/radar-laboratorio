"""Descarga y prepara los datos del laboratorio.

- Historia larga: archivos públicos de data.binance.vision (futuros USDT-M): velas de 1 h desde 2021 y funding.
- Lo reciente y las monedas que Binance no tiene: Hyperliquid (últimas 5000 velas de 1 h y su funding horario).
Cada archivo mensual se guarda en caché: en ejecuciones siguientes solo se descarga lo nuevo.

Convención de tiempos: el índice t es el final de la hora. P[t] es el cierre de la vela que acaba en t.
F_pago[t] es el funding que se paga en t, por la posición que se tenía en la hora que acaba en t.
F_info[t] es la tasa horaria equivalente conocida en t (sin mirar al futuro).
"""
import concurrent.futures as cf
import csv
import datetime as dt
import io
import json
import os
import time
import urllib.error
import urllib.request
import zipfile

import numpy as np

from .comun import H, MONEDAS_SERVIDOR

HL = 'https://api.hyperliquid.xyz/info'
VISION = 'https://data.binance.vision/data/futures/um'
INICIO = dt.datetime(2021, 1, 1, tzinfo=dt.timezone.utc)


def carpeta_datos():
    return os.environ.get('LAB_DATOS', 'datos')


def _http(url, cuerpo=None, intentos=5, timeout=60):
    """GET o POST con reintentos. Devuelve (estado, bytes). 400/403/404/451 no se reintentan."""
    estado = 0
    for i in range(intentos):
        try:
            datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
            req = urllib.request.Request(url, data=datos, headers={'Content-Type': 'application/json', 'User-Agent': 'radar-laboratorio/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            estado = e.code
            if e.code in (400, 403, 404, 451):
                return e.code, b''
            time.sleep(2 * (i + 1) + (10 if e.code == 429 else 0))
        except Exception:
            time.sleep(2 * (i + 1))
    return estado, b''


_ULTIMA_HL = [0.0]
PRESUPUESTO_HL = 1000.0  # peso por minuto; Hyperliquid permite 1200 por IP


def hl(cuerpo, peso=20):
    """Petición a Hyperliquid respetando su límite por peso: espera lo necesario antes de cada llamada."""
    espera = _ULTIMA_HL[0] + peso * 60.0 / PRESUPUESTO_HL - time.time()
    if espera > 0:
        time.sleep(espera)
    _ULTIMA_HL[0] = time.time()
    estado, b = _http(HL, cuerpo)
    return json.loads(b) if estado == 200 and b else None


def universo(n=60):
    """Los n perpetuos de Hyperliquid con más volumen en 24 h, más los 20 del servidor (nombres de Hyperliquid)."""
    r = hl({'type': 'metaAndAssetCtxs'})
    if not r:
        return list(MONEDAS_SERVIDOR)
    meta, ctxs = r
    filas = []
    for a, c in zip(meta['universe'], ctxs):
        if a.get('isDelisted'):
            continue
        filas.append((a['name'], float(c.get('dayNtlVlm') or 0)))
    filas.sort(key=lambda x: -x[1])
    out = list(MONEDAS_SERVIDOR)
    for nombre, _ in filas:
        if len(out) >= max(n, len(MONEDAS_SERVIDOR)):
            break
        if nombre not in out:
            out.append(nombre)
    return out


def simbolo_binance(coin):
    """Hyperliquid llama kPEPE a mil PEPE; Binance, 1000PEPEUSDT."""
    if len(coin) > 1 and coin[0] == 'k' and coin[1:].isupper():
        return '1000' + coin[1:] + 'USDT'
    return coin.upper() + 'USDT'


def _meses(desde, hasta):
    y, m = desde.year, desde.month
    while (y, m) <= (hasta.year, hasta.month):
        yield '%04d-%02d' % (y, m)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def _leer_zip_csv(b):
    with zipfile.ZipFile(io.BytesIO(b)) as z:
        texto = z.read(z.namelist()[0]).decode('utf-8', 'replace')
    filas = list(csv.reader(io.StringIO(texto)))
    if filas and filas[0] and not filas[0][0].strip().lstrip('-').isdigit():
        filas = filas[1:]  # cabecera
    return filas


def _ms(v):
    x = int(float(v))
    return x // 1000 if x > 10**14 else x  # algunos archivos recientes vienen en microsegundos


def _velas(filas):
    # open_time, open, high, low, close, volume, close_time, quote_volume, count, taker_buy_volume, taker_buy_quote_volume, ignore
    return np.array([[_ms(f[0]), float(f[4]), float(f[7]), float(f[10])] for f in filas if len(f) >= 11], dtype=np.float64)


def _tarea_binance(ruta, url, tipo):
    """Descarga un archivo y lo guarda como .npy (o marca .vacio si no existe). Devuelve el estado HTTP."""
    estado, b = _http(url, intentos=4)
    if estado == 200 and b:
        filas = _leer_zip_csv(b)
        if tipo == 'funding':
            # calc_time, funding_interval_hours, last_funding_rate
            arr = np.array([[_ms(f[0]), float(f[2])] for f in filas if len(f) >= 3], dtype=np.float64)
        else:
            arr = _velas(filas)
        np.save(ruta, arr)
    elif estado == 404:
        open(ruta + '.vacio', 'w').close()
    return estado


def descargar_binance(monedas, hilos=8, registro=None):
    """Velas de 1 h y funding de Binance USDT-M para todas las monedas, en paralelo y con caché."""
    registro = registro if registro is not None else {}
    ahora = dt.datetime.now(dt.timezone.utc)
    ultimo_mes = ahora.replace(day=1) - dt.timedelta(days=1)
    tareas = []
    for coin in monedas:
        sym = simbolo_binance(coin)
        carpeta = os.path.join(carpeta_datos(), 'binance', sym)
        os.makedirs(carpeta, exist_ok=True)
        for mes in _meses(INICIO, ultimo_mes):
            for tipo in ('klines', 'funding'):
                ruta = os.path.join(carpeta, '%s_%s.npy' % (tipo, mes))
                if os.path.exists(ruta) or os.path.exists(ruta + '.vacio'):
                    continue
                if tipo == 'klines':
                    url = '%s/monthly/klines/%s/1h/%s-1h-%s.zip' % (VISION, sym, sym, mes)
                else:
                    url = '%s/monthly/fundingRate/%s/%s-fundingRate-%s.zip' % (VISION, sym, sym, mes)
                tareas.append((ruta, url, tipo))
        # días del mes en curso (solo velas; los diarios de días ya cerrados no cambian)
        dia = ahora.replace(day=1).date()
        while dia < ahora.date():
            ruta = os.path.join(carpeta, 'klinesd_%s.npy' % dia.isoformat())
            if not os.path.exists(ruta) and not os.path.exists(ruta + '.vacio'):
                tareas.append((ruta, '%s/daily/klines/%s/1h/%s-1h-%s.zip' % (VISION, sym, sym, dia.isoformat()), 'klines'))
            dia += dt.timedelta(days=1)
    # comprobación previa: si Binance bloquea desde esta máquina, no insistir
    if tareas:
        estado = _tarea_binance(*tareas[0])
        registro['binance_estado_prueba'] = estado
        if estado in (403, 451) or estado == 0:
            registro['binance_bloqueado'] = estado
            return registro
        tareas = tareas[1:]
    estados = {}
    with cf.ThreadPoolExecutor(hilos) as ex:
        for e in ex.map(lambda a: _tarea_binance(*a), tareas):
            estados[e] = estados.get(e, 0) + 1
    registro['binance_descargas'] = estados
    # un 404 de un día reciente puede ser que aún no se ha publicado: se reintenta la próxima vez
    hace2 = (ahora - dt.timedelta(days=2)).date().isoformat()
    for coin in monedas:
        carpeta = os.path.join(carpeta_datos(), 'binance', simbolo_binance(coin))
        for f in os.listdir(carpeta):
            if f.startswith('klinesd_') and f.endswith('.vacio') and f[8:18] >= hace2:
                os.remove(os.path.join(carpeta, f))
    return registro


def _cargar_binance(coin):
    carpeta = os.path.join(carpeta_datos(), 'binance', simbolo_binance(coin))
    if not os.path.isdir(carpeta):
        return np.zeros((0, 4)), np.zeros((0, 2))
    kl = [np.load(os.path.join(carpeta, f)) for f in sorted(os.listdir(carpeta)) if f.startswith('klines') and f.endswith('.npy')]
    fu = [np.load(os.path.join(carpeta, f)) for f in sorted(os.listdir(carpeta)) if f.startswith('funding') and f.endswith('.npy')]
    kl = [k for k in kl if k.ndim == 2 and k.shape[0]]
    fu = [x for x in fu if x.ndim == 2 and x.shape[0]]
    return (np.concatenate(kl) if kl else np.zeros((0, 4))), (np.concatenate(fu) if fu else np.zeros((0, 2)))


def descargar_hl(coin, horas=5000, horas_funding=None):
    """Velas de 1 h recientes de Hyperliquid (hasta 5000) y el funding horario de las últimas horas_funding."""
    fin = int(time.time() * 1000) // H * H
    ini = fin - horas * H
    v = hl({'type': 'candleSnapshot', 'req': {'coin': coin, 'interval': '1h', 'startTime': ini - H, 'endTime': fin}}, peso=20 + horas // 60) or []
    # t es el inicio de la vela: su cierre corresponde al final de la hora
    velas = np.array([[int(k['t']) + H, float(k['c']), float(k['v']) * float(k['c'])] for k in v], dtype=np.float64) if v else np.zeros((0, 3))
    velas = velas[velas[:, 0] <= fin] if velas.size else velas  # la vela en curso no está cerrada
    tasas = []
    desde = fin - (horas_funding or horas) * H
    for _ in range(15):
        f = hl({'type': 'fundingHistory', 'coin': coin, 'startTime': desde, 'endTime': fin}, peso=45)
        if not f:
            break
        tasas += [[round(int(x['time']) / H) * H, float(x['fundingRate'])] for x in f]
        u = int(f[-1]['time'])
        if len(f) < 500 or u <= desde:
            break
        desde = u + 1
    return velas, (np.array(tasas, dtype=np.float64) if tasas else np.zeros((0, 2)))


def construir_panel(monedas, con_binance=True, horas_hl=5000, registro=None):
    """Matrices hora a hora [T, N].
    Precio: Binance donde lo hay (historia larga y sin empalmes); Hyperliquid rellena lo que falta,
    reescalado para que no haya salto en el empalme. Funding: Hyperliquid donde lo hay (es donde se opera),
    Binance antes."""
    registro = registro if registro is not None else {}
    if con_binance:
        descargar_binance(monedas, registro=registro)
    fin = int(time.time() * 1000) // H * H
    ini = int(INICIO.timestamp() * 1000) if con_binance and not registro.get('binance_bloqueado') else fin - horas_hl * H
    t = np.arange(ini, fin + H, H, dtype=np.int64)
    T, N = len(t), len(monedas)
    P = np.full((T, N), np.nan)
    V = np.full((T, N), np.nan)
    TB = np.full((T, N), np.nan)
    Fpago = np.zeros((T, N))
    Finfo = np.full((T, N), np.nan)
    fuente = {}

    def idx(ms):
        return ((np.asarray(ms, dtype=np.int64) - ini) // H).astype(np.int64)

    for j, coin in enumerate(monedas):
        fuentes = []
        if con_binance and not registro.get('binance_bloqueado'):
            k, fu = _cargar_binance(coin)
            if k.shape[0]:
                i = idx(k[:, 0] + H)
                ok = (i >= 0) & (i < T)
                P[i[ok], j] = k[ok, 1]; V[i[ok], j] = k[ok, 2]; TB[i[ok], j] = k[ok, 3]
                fuentes.append('binance')
            if fu.shape[0]:
                tpago = (fu[:, 0] // H) * H
                i = idx(tpago)
                ok = (i >= 0) & (i < T)
                np.add.at(Fpago[:, j], i[ok], fu[ok, 1])
                # información: la última tasa pagada, repartida por hora (8 h salvo que el intervalo sea otro)
                orden = np.argsort(tpago[ok])
                ii, rr = i[ok][orden], fu[ok, 1][orden]
                if ii.size > 1:
                    gap = np.diff(ii)
                    inter = np.r_[gap[0], gap].clip(1, 8)
                else:
                    inter = np.full(ii.size, 8)
                Finfo[ii, j] = rr / inter
                fuentes.append('funding binance')
        # con Binance hasta hace poco basta lo último de Hyperliquid; sin Binance, todo lo que da (5000 h)
        hay_binance = 'binance' in fuentes and np.isfinite(P[max(0, T - 24 * 7):, j]).any()
        velas, tasas = descargar_hl(coin, 72 if hay_binance else horas_hl, horas_funding=1000 if hay_binance else horas_hl)
        if velas.shape[0]:
            i = idx(velas[:, 0])
            ok = (i >= 0) & (i < T)
            i, vv = i[ok], velas[ok]
            hueco = np.isnan(P[i, j])
            if hueco.any():
                # reescalar en la última hora común antes del primer hueco (si la hay)
                comun = ~hueco
                escala = 1.0
                if comun.any():
                    k0 = np.where(comun)[0][-1] if not comun[-1] else np.where(comun)[0][0]
                    escala = P[i[k0], j] / vv[k0, 1]
                P[i[hueco], j] = vv[hueco, 1] * escala
                V[i[hueco], j] = vv[hueco, 2]
                fuentes.append('hyperliquid (%d h)' % int(hueco.sum()))
        if tasas.shape[0]:
            i = idx(tasas[:, 0])
            ok = (i >= 0) & (i < T)
            desde = i[ok].min() if ok.any() else T
            # desde que hay funding de Hyperliquid, manda el suyo (horario)
            Fpago[desde:, j] = 0.0
            Fpago[i[ok], j] = tasas[ok, 1]
            Finfo[i[ok], j] = tasas[ok, 1]
            fuentes.append('funding hyperliquid')
        fuente[coin] = ' + '.join(fuentes) or 'sin datos'
    # información de funding: se arrastra la última conocida (nunca la futura)
    for j in range(N):
        col = Finfo[:, j]
        ok = ~np.isnan(col)
        if ok.any():
            pos = np.where(ok, np.arange(T), 0)
            np.maximum.accumulate(pos, out=pos)
            Finfo[:, j] = np.where(np.arange(T) >= np.argmax(ok), col[pos], np.nan)
    return {'t': t, 'monedas': list(monedas), 'P': P, 'V': V, 'TB': TB, 'Fpago': Fpago, 'Finfo': Finfo, 'fuente': fuente, 'registro': registro}


def guardar_panel(panel, ruta):
    np.savez_compressed(ruta, t=panel['t'], monedas=np.array(panel['monedas']), P=panel['P'], V=panel['V'], TB=panel['TB'],
                        Fpago=panel['Fpago'], Finfo=panel['Finfo'], fuente=json.dumps(panel['fuente']), registro=json.dumps(panel.get('registro', {})))


def cargar_panel(ruta):
    z = np.load(ruta, allow_pickle=False)
    return {'t': z['t'], 'monedas': [str(m) for m in z['monedas']], 'P': z['P'], 'V': z['V'], 'TB': z['TB'],
            'Fpago': z['Fpago'], 'Finfo': z['Finfo'], 'fuente': json.loads(str(z['fuente'])), 'registro': json.loads(str(z['registro']))}
