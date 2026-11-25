"""Kraken frente a Hyperliquid: ¿lo que aprende el sistema se puede llevar al sitio donde operar es legal en España?

Kraken tiene licencia MiCA (cripto, Banco Central de Irlanda) y MiFID (derivados, CySEC), y ofrece perpetuos a
clientes del EEE. Hyperliquid es donde el servidor aprende. Este estudio usa solo datos públicos, sin claves:

1. Qué monedas del servidor tienen perpetuo en Kraken Futures: volumen, interés abierto, diferencial, orden mínima.
2. Cuánto cuesta de verdad una orden a mercado de 50, 200 y 1000 € en cada sitio (libro de órdenes + comisión).
3. Si precios y funding se parecen en las horas en común (hasta ~200 días).
4. Qué queda de las estrategias del laboratorio con las comisiones de Kraken (aproximación lineal sobre
   resultados/diagnostico.json: el coste resta en proporción al giro).

Uso: python -m lab.kraken --salida /tmp/kr [--diagnostico ../resultados/diagnostico.json]
"""
import argparse
import datetime as dt
import json
import math
import os
import time

import numpy as np

from .comun import COMISION, DESLIZAMIENTO, H, MONEDAS_SERVIDOR
from .datos import _http, descargar_hl, hl

KF = 'https://futures.kraken.com'
SPOT = 'https://api.kraken.com/0/public'
NOCIONALES_EUR = (50, 200, 1000)
HORAS = 4800  # ~200 días: lo que dan las velas de Hyperliquid (5000) con margen

# Comisiones de Kraken Pro, nivel 1 (menos de 10 000 $ al mes), tabla vigente desde el 9-7-2026:
# https://www.kraken.com/pro/fees y https://blog.kraken.com/product/pro/new-kraken-pro-fee-tiers
COMISIONES = {
    'hyperliquid': {'taker': 0.00045, 'maker': 0.00015},
    'kraken_futuros': {'taker': 0.0005, 'maker': 0.0002},
    'kraken_contado': {'taker': 0.008, 'maker': 0.004},
}
ALIAS_KRAKEN = {'XBT': 'BTC', 'XDG': 'DOGE'}


def _get(url, intentos=4):
    estado, b = _http(url, intentos=intentos, timeout=60)
    time.sleep(0.25)  # Kraken limita las peticiones públicas: sin prisa
    if estado != 200 or not b:
        return None
    try:
        return json.loads(b)
    except ValueError:
        return None


def base_hl(coin):
    """'kPEPE' -> ('PEPE', 1000): en Hyperliquid la k indica lotes de mil."""
    if coin.startswith('k') and coin[1:].isupper():
        return coin[1:], 1000
    return coin, 1


def base_kraken(simbolo):
    """'PF_XBTUSD' -> ('BTC', 1); 'PF_1000PEPEUSD' -> ('PEPE', 1000). None si no es un perpetuo lineal en USD."""
    if not simbolo.startswith('PF_') or not simbolo.endswith('USD'):
        return None
    b = simbolo[3:-3]
    mult = 1
    for m in (1000000, 1000):
        if b.startswith(str(m)) and len(b) > len(str(m)):
            b, mult = b[len(str(m)):], m
            break
    return ALIAS_KRAKEN.get(b, b), mult


def coste_mercado(niveles, nocional, mitad):
    """Coste de una orden a mercado de `nocional` USD recorriendo el libro (niveles [(precio, cantidad)] del mejor al
    peor), medido contra el precio medio: fracción (0.0005 = 5 pb). None si el libro no alcanza."""
    if not niveles or not mitad or mitad <= 0:
        return None
    resto, pagado, unidades = nocional, 0.0, 0.0
    for px, q in niveles:
        px, q = float(px), float(q)
        if px <= 0 or q <= 0:
            continue
        toma = min(resto, px * q)
        pagado += toma
        unidades += toma / px
        resto -= toma
        if resto <= 1e-9:
            break
    if resto > 1e-6 or unidades <= 0:
        return None
    medio = pagado / unidades
    return abs(medio / mitad - 1.0)


def coste_ida(compras, ventas, nocional):
    """Media de comprar y vender `nocional` USD a mercado: diferencial + impacto, sin comisión."""
    if not compras or not ventas:
        return None
    mitad = (float(compras[0][0]) + float(ventas[0][0])) / 2.0
    a = coste_mercado(ventas, nocional, mitad)   # comprar toma las ventas
    b = coste_mercado(compras, nocional, mitad)  # vender toma las compras
    if a is None or b is None:
        return None
    return (a + b) / 2.0


def alinear(ta, pa, tb, pb):
    """Cierres horarios de dos fuentes en las horas comunes."""
    da = dict(zip(np.asarray(ta, dtype=np.int64).tolist(), pa))
    comunes = [(t, da[t], p) for t, p in zip(np.asarray(tb, dtype=np.int64).tolist(), pb) if t in da]
    if not comunes:
        return np.zeros(0, dtype=np.int64), np.zeros(0), np.zeros(0)
    t, a, b = zip(*sorted(comunes))
    return np.array(t, dtype=np.int64), np.array(a, dtype=float), np.array(b, dtype=float)


def comparar_precios(tk, pk, th, ph):
    """Kraken (k) frente a Hyperliquid (h), mismas unidades: correlación de rendimientos horarios, desviación de la
    diferencia de rendimientos (pb/hora) y diferencia media de precio (pb). Solo horas consecutivas."""
    t, a, b = alinear(tk, pk, th, ph)
    if len(t) < 48:
        return None
    seguidas = np.diff(t) == H
    ra, rb = np.diff(np.log(a))[seguidas], np.diff(np.log(b))[seguidas]
    ok = np.isfinite(ra) & np.isfinite(rb)
    ra, rb = ra[ok], rb[ok]
    if len(ra) < 24 or ra.std() == 0 or rb.std() == 0:
        return None
    return {
        'horas_comunes': int(len(t)),
        'correlacion': round(float(np.corrcoef(ra, rb)[0, 1]), 4),
        'seguimiento_pb_hora': round(float((ra - rb).std() * 1e4), 2),
        'diferencia_precio_pb': round(float(np.median(a / b - 1.0) * 1e4), 2),
    }


def funding_horario(filas):
    """Tasas relativas de Kraken [(t_ms, tasa)] -> (tasa por hora equivalente, intervalo en horas).
    El intervalo se deduce de los datos (la documentación muestra cada 4 h; puede ser cada hora)."""
    if len(filas) < 3:
        return [], None
    filas = sorted(filas)
    t = np.array([f[0] for f in filas], dtype=np.int64)
    inter = float(np.median(np.diff(t))) / H
    inter = max(1.0, round(inter))
    return [(int(ti), float(r) / inter) for ti, r in filas], inter


def comparar_funding(fk, fh, desde):
    """Funding por hora de Kraken y de Hyperliquid desde `desde`: medias anualizadas (positivo = el comprado paga)
    y correlación diaria."""
    fk = [(t, r) for t, r in fk if t >= desde]
    fh = [(t, r) for t, r in fh if t >= desde]
    if len(fk) < 24 or len(fh) < 24:
        return None
    ak = float(np.mean([r for _, r in fk])) * 8760 * 100
    ah = float(np.mean([r for _, r in fh])) * 8760 * 100

    def por_dia(f):
        d = {}
        for t, r in f:
            d.setdefault(t // 86_400_000, []).append(r)
        return {k: float(np.mean(v)) for k, v in d.items()}
    dk, dh = por_dia(fk), por_dia(fh)
    dias = sorted(set(dk) & set(dh))
    corr = None
    if len(dias) >= 10:
        x, y = np.array([dk[d] for d in dias]), np.array([dh[d] for d in dias])
        if x.std() > 0 and y.std() > 0:
            corr = round(float(np.corrcoef(x, y)[0, 1]), 3)
    return {'kraken_anual_pct': round(ak, 2), 'hyperliquid_anual_pct': round(ah, 2),
            'diferencia_anual_pct': round(ak - ah, 2), 'correlacion_diaria': corr, 'dias': len(dias)}


def con_comisiones(simulaciones, costes, coste_lab=COMISION + DESLIZAMIENTO):
    """Rentabilidad anual aproximada de cada simulación del laboratorio con otro coste por unidad de giro.
    rent(c) = rent_sin - (rent_sin - rent_con) * c / coste_lab. Aproximación lineal: ignora el interés compuesto."""
    out = {}
    for nombre, v in simulaciones.items():
        c, s = v.get('con_costes', {}), v.get('sin_costes', {})
        if 'rent_anual_pct' not in c or 'rent_anual_pct' not in s:
            continue
        sin, con = float(s['rent_anual_pct']), float(c['rent_anual_pct'])
        arrastre = max(sin - con, 1e-9)  # puntos que resta el coste del laboratorio
        fila = {'giro_anual': v.get('giro_anual'), 'sin_costes_pct': round(sin, 2),
                'solo_compras': ('_lar_' in nombre) or nombre.startswith('siempre_comprado'),
                'coste_que_lo_anula_pct': round(coste_lab * sin / arrastre * 100, 3) if sin > 0 else 0.0}
        for sitio, cc in costes.items():
            fila[sitio] = round(sin - arrastre * cc / coste_lab, 2)
        out[nombre] = fila
    return out


def leer_kraken():
    """Instrumentos y tickers de Kraken Futures, por moneda del servidor."""
    ins = (_get(KF + '/derivatives/api/v3/instruments') or {}).get('instruments', [])
    tic = {x.get('symbol'): x for x in (_get(KF + '/derivatives/api/v3/tickers') or {}).get('tickers', [])}
    por_base = {}
    for i in ins:
        s = i.get('symbol', '')
        b = base_kraken(s)
        if not b or i.get('tradeable') is False:
            continue
        por_base.setdefault(b[0], []).append((b[1], s, i))
    return por_base, tic


def apalancamiento(i, campo):
    niveles = i.get(campo) or []
    try:
        return round(1.0 / float(niveles[0]['initialMargin']), 1) if niveles else None
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None


def velas_kraken(simbolo, horas):
    fin = int(time.time()) // 3600 * 3600
    desde = fin - horas * 3600
    out = {}
    for _ in range(10):
        j = _get('%s/api/charts/v1/trade/%s/1h?from=%d&to=%d' % (KF, simbolo, desde, fin))
        if not j or not j.get('candles'):
            break
        ult = desde
        for c in j['candles']:
            t = int(c['time'])
            t = t * 1000 if t < 10**11 else t
            out[t + H] = float(c['close'])  # la vela empieza en t: su cierre es al final de la hora
            ult = max(ult, t // 1000)
        if not j.get('more_candles') or ult <= desde:
            break
        desde = ult + 1
    fin_ms = fin * 1000
    t = sorted(k for k in out if k <= fin_ms)  # sin la vela en curso
    return np.array(t, dtype=np.int64), np.array([out[k] for k in t])


def funding_kraken(simbolo):
    j = _get('%s/derivatives/api/v3/historical-funding-rates?symbol=%s' % (KF, simbolo)) or {}
    filas = []
    for r in j.get('rates', []):
        try:
            t = int(dt.datetime.fromisoformat(r['timestamp'].replace('Z', '+00:00')).timestamp() * 1000)
            filas.append((t, float(r['relativeFundingRate'])))
        except (KeyError, TypeError, ValueError):
            continue
    return funding_horario(filas)


def libro_kraken(simbolo):
    j = (_get('%s/derivatives/api/v3/orderbook?symbol=%s' % (KF, simbolo)) or {}).get('orderBook') or {}
    compras = sorted(((float(p), float(q)) for p, q in j.get('bids', [])), key=lambda x: -x[0])
    ventas = sorted(((float(p), float(q)) for p, q in j.get('asks', [])), key=lambda x: x[0])
    return compras, ventas


def libro_hl(coin):
    j = hl({'type': 'l2Book', 'coin': coin}, peso=2) or {}
    lv = j.get('levels') or [[], []]
    compras = [(float(x['px']), float(x['sz'])) for x in lv[0]]
    ventas = [(float(x['px']), float(x['sz'])) for x in lv[1]]
    return compras, ventas


def eur_usd():
    j = _get(SPOT + '/Ticker?pair=EURUSD') or {}
    try:
        return float(list(j['result'].values())[0]['c'][0])
    except (KeyError, IndexError, TypeError, ValueError):
        return 1.16  # aproximación si Kraken no responde


def estudiar(monedas, diagnostico=None):
    eur = eur_usd()
    meta = {u['name']: u for u in ((hl({'type': 'meta'}, peso=20) or {}).get('universe') or [])}
    por_base, tic = leer_kraken()
    fin = int(time.time() * 1000) // H * H
    filas = []
    for coin in monedas:
        b, mult_h = base_hl(coin)
        f = {'moneda': coin, 'en_kraken': False}
        opciones = sorted(por_base.get(b, []), key=lambda x: x[0])
        # libro y comisión en Hyperliquid
        ch, vh = libro_hl(coin)
        f['hyperliquid'] = {'coste_ida_pct': {}, 'orden_min_usd': 10.0,
                            'apalancamiento_max': (meta.get(coin) or {}).get('maxLeverage')}
        for n in NOCIONALES_EUR:
            c = coste_ida(ch, vh, n * eur)
            f['hyperliquid']['coste_ida_pct'][str(n)] = None if c is None else round((c + COMISIONES['hyperliquid']['taker']) * 100, 4)
        if opciones:
            mult_k, sim, ins = opciones[0]
            t = tic.get(sim, {})
            f['en_kraken'] = True
            ck, vk = libro_kraken(sim)
            precio = float(t.get('markPrice') or t.get('last') or 0)
            prec = ins.get('contractValueTradePrecision')
            minimo = (10.0 ** (-float(prec))) * precio if prec is not None and precio else None
            bid, ask = float(t.get('bid') or 0), float(t.get('ask') or 0)
            f['kraken'] = {
                'simbolo': sim,
                'volumen_24h_musd': round(float(t.get('volumeQuote') or 0) / 1e6, 2),
                'interes_abierto_musd': round(float(t.get('openInterest') or 0) * precio / 1e6, 2),
                'diferencial_pb': round((ask / bid - 1) * 1e4, 2) if bid > 0 and ask > 0 else None,
                'orden_min_usd': round(minimo, 2) if minimo else None,
                'apalancamiento_max': apalancamiento(ins, 'marginLevels'),
                'apalancamiento_max_minorista': apalancamiento(ins, 'retailMarginLevels'),
                'coste_ida_pct': {},
            }
            for n in NOCIONALES_EUR:
                c = coste_ida(ck, vk, n * eur)
                f['kraken']['coste_ida_pct'][str(n)] = None if c is None else round((c + COMISIONES['kraken_futuros']['taker']) * 100, 4)
            # historia: precios y funding en las horas comunes
            tk, pk = velas_kraken(sim, HORAS)
            velas, tasas = descargar_hl(coin, HORAS, horas_funding=HORAS)
            if len(tk) and velas.shape[0]:
                # mismas unidades: precio por moneda entera
                f['precios'] = comparar_precios(tk, pk / mult_k, velas[:, 0], velas[:, 1] / mult_h)
            fk, inter = funding_kraken(sim)
            f['funding_intervalo_kraken_h'] = inter
            if fk and tasas.shape[0]:
                fh = [(int(a), float(r)) for a, r in tasas]
                f['funding'] = comparar_funding(fk, fh, fin - HORAS * H)
                if inter and inter > 1:  # por si Kraken ya publica la tasa por hora aunque la cobre cada `inter` horas
                    f['funding_si_ya_es_horaria'] = comparar_funding([(t, x * inter) for t, x in fk], fh, fin - HORAS * H)
        filas.append(f)
    out = {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'eur_usd': eur, 'comisiones': COMISIONES, 'monedas': filas,
        'perpetuos_kraken': sum(len(v) for v in por_base.values()),
    }
    if diagnostico and diagnostico.get('simulaciones'):
        imp = [x['kraken']['coste_ida_pct'].get('200') for x in filas if x.get('kraken') and x['kraken']['coste_ida_pct'].get('200') is not None]
        imp_k = float(np.median(imp)) / 100 - COMISIONES['kraken_futuros']['taker'] if imp else DESLIZAMIENTO
        imp_k = max(imp_k, 0.0)
        costes = {
            'hyperliquid': COMISION + DESLIZAMIENTO,
            'kraken_futuros': COMISIONES['kraken_futuros']['taker'] + max(imp_k, DESLIZAMIENTO),
            'kraken_contado': COMISIONES['kraken_contado']['taker'] + DESLIZAMIENTO,
        }
        out['costes_por_giro'] = {k: round(v * 100, 4) for k, v in costes.items()}
        out['estrategias'] = con_comisiones(diagnostico['simulaciones'], costes)
        out['estrategias_de'] = diagnostico.get('generado')
    return out


def _p(x, fmt='%.2f'):
    return '—' if x is None else fmt % x


def informe(r):
    l = ['# Kraken frente a Hyperliquid\n',
         'Generado %s. Datos públicos, sin claves. Kraken tiene licencia MiCA (cripto) y MiFID (derivados) en el EEE; '
         'Hyperliquid es donde aprende el servidor. Investigación en papel, no es asesoramiento.\n' % r['generado'],
         'Comisiones de toma (taker), nivel 1: Hyperliquid %.3f %%, Kraken Futuros %.3f %%, Kraken contado %.2f %%. '
         'EUR/USD %.4f. Perpetuos lineales en USD en Kraken: %d.\n' % (
             r['comisiones']['hyperliquid']['taker'] * 100, r['comisiones']['kraken_futuros']['taker'] * 100,
             r['comisiones']['kraken_contado']['taker'] * 100, r['eur_usd'], r['perpetuos_kraken'])]
    l += ['## Coste real de una orden a mercado (ida, con comisión)\n',
          '| Moneda | En Kraken | Kraken 50 € | 200 € | 1000 € | Hyperliquid 50 € | 200 € | 1000 € | Orden mín. Kraken | Apal. máx. Kraken (minorista) | Volumen 24 h Kraken |',
          '|---|---|---|---|---|---|---|---|---|---|---|']
    for f in r['monedas']:
        k, h = f.get('kraken') or {}, f['hyperliquid']
        kc, hc = k.get('coste_ida_pct', {}), h['coste_ida_pct']
        l.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            f['moneda'], 'sí' if f['en_kraken'] else 'no',
            _p(kc.get('50'), '%.3f %%'), _p(kc.get('200'), '%.3f %%'), _p(kc.get('1000'), '%.3f %%'),
            _p(hc.get('50'), '%.3f %%'), _p(hc.get('200'), '%.3f %%'), _p(hc.get('1000'), '%.3f %%'),
            _p(k.get('orden_min_usd'), '%.2f $'),
            '%s (%s)' % (_p(k.get('apalancamiento_max'), '%gx'), _p(k.get('apalancamiento_max_minorista'), '%gx')) if k else '—',
            _p(k.get('volumen_24h_musd'), '%.1f M$')))
    l += ['\nUna sola foto del libro: varía según la hora. El coste incluye diferencial, impacto y comisión de toma.\n',
          '## ¿Se mueven igual? (horas en común, hasta ~200 días)\n',
          '| Moneda | Horas | Correlación horaria | Diferencia de seguimiento (pb/h) | Kraken − HL precio (pb) | Funding Kraken (anual) | Funding HL (anual) | Correlación diaria funding | Intervalo funding Kraken |',
          '|---|---|---|---|---|---|---|---|---|']
    for f in r['monedas']:
        if not f['en_kraken']:
            continue
        p, fu = f.get('precios') or {}, f.get('funding') or {}
        l.append('| %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (
            f['moneda'], p.get('horas_comunes', '—'), _p(p.get('correlacion'), '%.3f'), _p(p.get('seguimiento_pb_hora')),
            _p(p.get('diferencia_precio_pb'), '%+.1f'), _p(fu.get('kraken_anual_pct'), '%+.1f %%'),
            _p(fu.get('hyperliquid_anual_pct'), '%+.1f %%'), _p(fu.get('correlacion_diaria'), '%.2f'),
            _p(f.get('funding_intervalo_kraken_h'), '%g h')))
    dobles = [f for f in r['monedas'] if f.get('funding_si_ya_es_horaria')]
    if dobles:
        l.append('\nKraken publica el funding cada %g h. Arriba se reparte entre esas horas; si su tasa ya fuera por hora, '
                 'el funding anual de Kraken sería: %s.\n' % (dobles[0]['funding_intervalo_kraken_h'], ', '.join(
                     '%s %s' % (f['moneda'], _p(f['funding_si_ya_es_horaria'].get('kraken_anual_pct'), '%+.1f %%')) for f in dobles)))
    if r.get('estrategias'):
        c = r['costes_por_giro']
        l += ['\n## Las estrategias del laboratorio con las comisiones de cada sitio\n',
              'Coste por cada 100 %% de giro: Hyperliquid %.3f %%, Kraken Futuros %.3f %%, Kraken contado %.3f %%. '
              'Aproximación lineal sobre el diagnóstico del laboratorio (%s): el coste resta en proporción al giro.\n' % (
                  c['hyperliquid'], c['kraken_futuros'], c['kraken_contado'], r.get('estrategias_de', '')),
              '| Estrategia | Giro anual | Sin costes | Hyperliquid | Kraken Futuros | Kraken contado | Coste que la anula | ¿Posible en contado? |',
              '|---|---|---|---|---|---|---|---|']
        for n, v in r['estrategias'].items():
            l.append('| %s | %s | %+.1f %% | %+.1f %% | %+.1f %% | %+.1f %% | %.2f %% | %s |' % (
                n.replace('_', ' '), _p(v['giro_anual'], '%.0f'), v['sin_costes_pct'], v['hyperliquid'], v['kraken_futuros'],
                v['kraken_contado'], v['coste_que_lo_anula_pct'], 'sí' if v['solo_compras'] else 'no (vende en corto)'))
    l.append('\nLectura: si los costes de Kraken Futuros son parecidos a los de Hyperliquid y los precios se mueven igual, '
             'lo aprendido en Hyperliquid vale para Kraken Futuros. El contado de Kraken solo sirve para estrategias de poco giro y solo compradoras.\n')
    return '\n'.join(l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='/tmp/kr')
    ap.add_argument('--diagnostico', default=os.path.join('..', 'resultados', 'diagnostico.json'))
    a = ap.parse_args()
    os.makedirs(a.salida, exist_ok=True)
    try:
        diag = json.load(open(a.diagnostico))
    except (OSError, ValueError):
        diag = None
    r = estudiar(MONEDAS_SERVIDOR, diag)
    with open(os.path.join(a.salida, 'kraken.json'), 'w') as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(r))
    print(json.dumps({'monedas_en_kraken': sum(x['en_kraken'] for x in r['monedas']), 'perpetuos_kraken': r['perpetuos_kraken']}))
    if not any(x['en_kraken'] for x in r['monedas']):
        raise SystemExit('Kraken no devolvió instrumentos: revisar la API')


if __name__ == '__main__':
    main()
