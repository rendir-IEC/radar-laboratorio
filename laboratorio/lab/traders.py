"""Aprender de los traders con su historial completo, en vez de esperar meses a verlos en vivo.

Datos públicos de Hyperliquid, sin clave:
- ranking (todas las cuentas, con su volumen y resultado) y lista de vaults (cuentas gestionadas con dinero de otros);
- historial de cada cuenta (info API, `portfolio`): su valor y su resultado acumulado desde que empezó.

Pasos:
1. Grupo: las cuentas con más volumen (también las que perdieron, para no elegir con lo que se sabe hoy) y los vaults abiertos.
2. Puntuación de cada cuenta en una fecha, solo con lo que se sabía entonces: t de sus rendimientos quincenales del
   último año (media / desviación × raíz del número de quincenas). Premia ganar a menudo y con poco riesgo, no un golpe de suerte.
3. Validación mes a mes: ¿la puntuación de fin de mes predice el mes siguiente? ¿Mejor que la racha del último mes?
4. Selección de hoy: las 30 cuentas con mejor puntuación que siguen activas, para que el servidor las siga en papel.
   Si la validación sale bien, el servidor parte de esa puntuación (encogida) como habilidad previa; si no, la aprende en vivo.

Uso: python -m lab.traders --salida ../resultados/traders [--grupo 1200] [--vaults 300]
"""
import argparse
import bisect
import datetime as dt
import json
import math
import os
import time

import numpy as np

from .datos import _http
from .mejores import fines_de_mes, historial, ranking, spearman

VAULTS = 'https://stats-data.hyperliquid.xyz/Mainnet/vaults'
DIA = 86_400_000
PASO_DIAS = 14            # el historial completo trae un punto cada ~10 días: se mide por quincenas
VENTANA_DIAS = 365        # la puntuación mira el último año
MIN_PERIODOS = 8          # al menos 8 quincenas con la cuenta por encima del mínimo
MIN_ACTIVAS = 4           # y al menos 4 en las que el resultado se movió (que haya operado)
SD_MINIMA = 0.005         # 0,5 % por quincena: una cuenta casi parada no saca una t enorme por no moverse
RECORTE = (-1.0, 3.0)     # una quincena extrema no decide la puntuación
N_SELECCION = 30          # el servidor sigue como mucho 30 cuentas (límite de peticiones por minuto)
MAX_VOLUMEN_POR_VALOR = 2000.0  # más volumen que eso por cada dólar de la cuenta: creador de mercado, no se copia


def vaults():
    """Vaults de Hyperliquid, también los cerrados (para no estudiar solo a los que sobrevivieron):
    [{direccion, nombre, tvl, lider, cerrado}] y el estado HTTP (para el diagnóstico)."""
    estado, b = _http(VAULTS, intentos=3, timeout=120)
    if estado != 200 or not b:
        return [], estado
    try:
        j = json.loads(b)
    except ValueError:
        return [], -1
    filas = j if isinstance(j, list) else (j.get('vaults') or j.get('rows') or [])
    out = []
    for v in filas:
        s = v.get('summary', v) if isinstance(v, dict) else {}
        addr = str(s.get('vaultAddress') or '').lower()
        if not addr.startswith('0x') or len(addr) != 42:
            continue
        nombre = str(s.get('name') or '')
        if 'hyperliquidity provider' in nombre.lower() or nombre.strip().upper() == 'HLP':
            continue  # el creador de mercado del propio exchange: no es un trader al que copiar
        try:
            tvl = float(s.get('tvl') or 0)
        except (TypeError, ValueError):
            tvl = 0.0
        out.append({'direccion': addr, 'nombre': nombre[:60], 'tvl': tvl, 'lider': str(s.get('leader') or '').lower(), 'cerrado': bool(s.get('isClosed'))})
    return out, estado


def en(serie, t):
    """Último valor de la serie [(t, v)] en o antes de t (None si no hay). Búsqueda binaria: el estudio la llama millones de veces."""
    i = bisect.bisect_right(serie, (t, math.inf))
    return serie[i - 1][1] if i else None


def rendimientos(h, desde, hasta, min_valor):
    """Rendimiento de cada quincena entre desde y hasta: resultado de la quincena / valor al empezarla.
    Solo quincenas que empiezan con la cuenta por encima de min_valor. Devuelve [(t_fin, r)]."""
    out = []
    t = desde
    while t + PASO_DIAS * DIA <= hasta:
        t1 = t + PASO_DIAS * DIA
        v0 = en(h['valor'], t)
        p0, p1 = en(h['pnl'], t), en(h['pnl'], t1)
        if v0 is not None and p0 is not None and p1 is not None and v0 >= min_valor:
            out.append((t1, (p1 - p0) / v0))
        t = t1
    return out


def puntuar(h, T, min_valor):
    """Puntuación de una cuenta en la fecha T con su último año: dict con t, quincenas, media y rentabilidad anual, o None."""
    rs = rendimientos(h, T - VENTANA_DIAS * DIA, T, min_valor)
    if len(rs) < MIN_PERIODOS:
        return None
    r = np.clip(np.array([x[1] for x in rs], dtype=float), *RECORTE)
    if int(np.sum(np.abs(r) > 1e-9)) < MIN_ACTIVAS:
        return None
    m = float(r.mean())
    sd = max(float(r.std(ddof=1)), SD_MINIMA)
    return {
        't': round(m / sd * math.sqrt(len(r)), 3),
        'quincenas': len(r),
        'media_quincena_pct': round(m * 100, 3),
        'rent_anual_pct': round((float(np.prod(1 + r)) ** (365.0 / (PASO_DIAS * len(r))) - 1) * 100, 1),
        'quincenas_positivas_pct': round(float(np.mean(r > 0)) * 100, 1),
    }


def rend_mes(h, t0, t1, min_valor):
    v0 = en(h['valor'], t0)
    p0, p1 = en(h['pnl'], t0), en(h['pnl'], t1)
    if v0 is None or p0 is None or p1 is None or v0 < min_valor:
        return None
    return float(np.clip((p1 - p0) / v0, *RECORTE))


def _t(xs):
    xs = np.asarray(xs, dtype=float)
    if len(xs) < 2 or xs.std(ddof=1) == 0:
        return 0.0
    return float(xs.mean() / (xs.std(ddof=1) / math.sqrt(len(xs))))


def validar(historias, min_valor=10_000.0, min_cuentas=40, top=N_SELECCION):
    """Mes a mes, con lo que se sabía a fin de mes: ¿la puntuación predice el mes siguiente? ¿Y la racha del último mes?
    Compara también una cartera que copia por igual a las `top` mejores por puntuación con la media de todas."""
    todos_t = [t for h in historias.values() for t, _ in h['pnl']]
    if not todos_t:
        return {'meses': []}
    cortes = fines_de_mes(min(todos_t), max(todos_t))
    meses = []
    for k in range(1, len(cortes) - 1):
        T, T1, T0 = cortes[k], cortes[k + 1], cortes[k - 1]
        filas = []
        for h in historias.values():
            s = puntuar(h, T, min_valor)
            b = rend_mes(h, T, T1, min_valor)
            a = rend_mes(h, T0, T, min_valor)
            if s is None or b is None or a is None:
                continue
            filas.append((s['t'], a, b))
        if len(filas) < min_cuentas:
            continue
        sc = np.array([f[0] for f in filas])
        ra = np.array([f[1] for f in filas])
        sig = np.array([f[2] for f in filas])
        orden = np.argsort(-sc)
        n_top = min(top, max(5, len(filas) // 10))
        elegidas = orden[:n_top]
        orden_racha = np.argsort(-ra)[:n_top]
        meses.append({
            'mes_eleccion': dt.datetime.fromtimestamp(T / 1000, dt.timezone.utc).strftime('%Y-%m'),
            'cuentas': len(filas),
            'ic_puntuacion': round(spearman(sc, sig), 3),
            'ic_racha': round(spearman(ra, sig), 3),
            'elegidas': int(n_top),
            'elegidas_mes_siguiente_pct': round(float(sig[elegidas].mean()) * 100, 2),
            'racha_mes_siguiente_pct': round(float(sig[orden_racha].mean()) * 100, 2),
            'todas_mes_siguiente_pct': round(float(sig.mean()) * 100, 2),
            'elegidas_ganan_pct': round(float(np.mean(sig[elegidas] > 0)) * 100, 1),
            'todas_ganan_pct': round(float(np.mean(sig > 0)) * 100, 1),
        })
    res = {'meses': meses}
    if meses:
        ic = [m['ic_puntuacion'] for m in meses]
        icr = [m['ic_racha'] for m in meses]
        ventaja = [m['elegidas_mes_siguiente_pct'] - m['todas_mes_siguiente_pct'] for m in meses]
        ventaja_racha = [m['racha_mes_siguiente_pct'] - m['todas_mes_siguiente_pct'] for m in meses]
        res['resumen'] = {
            'meses_estudiados': len(meses),
            'ic_puntuacion_media': round(float(np.mean(ic)), 3), 't_ic_puntuacion': round(_t(ic), 2),
            'ic_racha_media': round(float(np.mean(icr)), 3), 't_ic_racha': round(_t(icr), 2),
            'ventaja_elegidas_pct_mes': round(float(np.mean(ventaja)), 2), 't_ventaja_elegidas': round(_t(ventaja), 2),
            'meses_con_ventaja_pct': round(float(np.mean(np.array(ventaja) > 0)) * 100, 1),
            'ventaja_racha_pct_mes': round(float(np.mean(ventaja_racha)), 2), 't_ventaja_racha': round(_t(ventaja_racha), 2),
            'elegidas_mes_siguiente_mediana_pct': round(float(np.median([m['elegidas_mes_siguiente_pct'] for m in meses])), 2),
        }
        s = res['resumen']
        # la previa solo se usa si la puntuación predice de verdad: relación positiva y estadísticamente clara
        s['usar_previa'] = bool(s['ic_puntuacion_media'] > 0 and s['t_ic_puntuacion'] >= 2.0 and s['ventaja_elegidas_pct_mes'] > 0)
    return res


def seleccionar(historias, info, ahora_ms, min_valor_hoy=50_000.0, n=N_SELECCION):
    """Las n cuentas con mejor puntuación hoy, entre las que siguen activas (su resultado se movió en los últimos 30 días),
    con al menos min_valor_hoy y sin pinta de creador de mercado."""
    cands = []
    for d, h in historias.items():
        meta = info.get(d, {})
        valor = h['valor'][-1][1] if h['valor'] else 0.0
        if valor < min_valor_hoy:
            continue
        if meta.get('cerrado') or meta.get('vlm_total', 0) > MAX_VOLUMEN_POR_VALOR * max(valor, 1.0):
            continue
        p_hoy, p_30 = en(h['pnl'], ahora_ms), en(h['pnl'], ahora_ms - 30 * DIA)
        if p_hoy is None or p_30 is None or abs(p_hoy - p_30) < 1e-6:
            continue
        s = puntuar(h, ahora_ms, min_valor=10_000.0)
        if s is None or s['t'] <= 0:
            continue
        cands.append(dict(s, direccion=d, valor=round(valor), tipo=meta.get('tipo', 'cuenta'), nombre=meta.get('nombre', '')))
    cands.sort(key=lambda c: -c['t'])
    return cands[:n], len(cands)


def informe(r):
    l = ['# Aprender de los traders con su historial completo\n',
         '> Datos públicos de Hyperliquid (ranking, vaults e historial de cada cuenta). Investigación en papel; no es una recomendación.\n',
         '- Generado: %s.' % r['generado'],
         '- Grupo: las %d cuentas con más volumen acumulado (también las que perdieron) y %d vaults, abiertos y cerrados (lista de vaults: HTTP %s). Historiales leídos: %d.' % (r['grupo_cuentas'], r['grupo_vaults'], r['estado_vaults'], r['historiales']),
         '- Puntuación: t de los rendimientos quincenales del último año (media / desviación × raíz del número de quincenas), con al menos %d quincenas por encima de 10.000 $.\n' % MIN_PERIODOS]
    e = r['validacion']
    if 'resumen' in e:
        s = e['resumen']
        l.append('## ¿La puntuación predice el mes siguiente?\n')
        l.append('- Meses estudiados: %d.' % s['meses_estudiados'])
        l.append('- Relación entre la puntuación de fin de mes y el mes siguiente: **%.2f** de media (t = %.1f). Con la racha del último mes: %.2f (t = %.1f).' % (s['ic_puntuacion_media'], s['t_ic_puntuacion'], s['ic_racha_media'], s['t_ic_racha']))
        l.append('- Las elegidas por puntuación rinden el mes siguiente **%+.2f puntos** frente a la media de todas (t = %.1f), con ventaja en el %.0f %% de los meses. Elegidas por la racha del último mes: %+.2f puntos (t = %.1f).' % (s['ventaja_elegidas_pct_mes'], s['t_ventaja_elegidas'], s['meses_con_ventaja_pct'], s['ventaja_racha_pct_mes'], s['t_ventaja_racha']))
        l.append('- ¿El servidor usa la puntuación como habilidad previa? **%s**.\n' % ('Sí' if s['usar_previa'] else 'No: la aprende en vivo, como hasta ahora'))
        l.append('| Mes de elección | Cuentas | Relación (puntuación) | Relación (racha) | Elegidas, mes siguiente | Por racha | Todas | Elegidas que ganan | Todas que ganan |')
        l.append('|---|---|---|---|---|---|---|---|---|')
        for m in e['meses']:
            l.append('| %s | %d | %.2f | %.2f | %+.2f %% | %+.2f %% | %+.2f %% | %.0f %% | %.0f %% |' % (m['mes_eleccion'], m['cuentas'], m['ic_puntuacion'], m['ic_racha'], m['elegidas_mes_siguiente_pct'], m['racha_mes_siguiente_pct'], m['todas_mes_siguiente_pct'], m['elegidas_ganan_pct'], m['todas_ganan_pct']))
    else:
        l.append('No hubo suficientes cuentas con historial para validar ningún mes.')
    l.append('\n## Las %d que sigue el servidor desde hoy\n' % len(r['carteras']))
    l.append('Candidatas activas con puntuación positiva: %d.\n' % r['candidatas'])
    l.append('| Cuenta | Tipo | Puntuación (t) | Quincenas | En positivo | Media por quincena | Valor |')
    l.append('|---|---|---|---|---|---|---|')
    for c in r['carteras']:
        nombre = (' «%s»' % c['nombre'].replace('|', '/')) if c.get('nombre') else ''
        l.append('| %s…%s%s | %s | %.2f | %d | %.0f %% | %+.1f %% | %s $ |' % (c['direccion'][:6], c['direccion'][-4:], nombre, c['tipo'], c['t'], c['quincenas'], c['quincenas_positivas_pct'], c['media_quincena_pct'], format(int(c['valor']), ',').replace(',', '.')))
    l.append('\nLa media por quincena es sobre el valor de la cuenta al empezar cada quincena; con depósitos y retiradas grandes puede exagerarse. Cuidado: el grupo se elige por el volumen acumulado hasta hoy, así que favorece algo a las cuentas que siguieron operando.')
    return '\n'.join(l) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='../resultados/traders')
    ap.add_argument('--grupo', type=int, default=1200)
    ap.add_argument('--vaults', type=int, default=300)
    ap.add_argument('--min-valor', type=float, default=10_000.0)
    a = ap.parse_args()
    t0 = time.time()
    filas = ranking()
    filas.sort(key=lambda r: -r['vlm_total'])
    grupo = filas[: a.grupo]
    info = {c['direccion']: dict(c, tipo='cuenta') for c in grupo}
    lista_v, estado_v = vaults()
    lista_v.sort(key=lambda v: -v['tvl'])
    # los abiertos con más dinero, y los cerrados también (con su historial), para no estudiar solo a los supervivientes
    abiertos = [v for v in lista_v if not v['cerrado'] and v['tvl'] >= 10_000][: a.vaults]
    cerrados = [v for v in lista_v if v['cerrado']][: a.vaults // 3]
    lista_v = abiertos + cerrados
    for v in lista_v:
        info.setdefault(v['direccion'], {'direccion': v['direccion'], 'vlm_total': 0.0})
        info[v['direccion']].update(tipo='vault', nombre=v['nombre'], cerrado=v['cerrado'])
    historias = {}
    for d in info:
        h = historial(d)
        if h and h['pnl'] and h['valor']:
            h['pnl'].sort()
            h['valor'].sort()
            historias[d] = h
    ahora = max(t for h in historias.values() for t, _ in h['pnl']) if historias else int(time.time() * 1000)
    validacion = validar(historias, min_valor=a.min_valor)
    carteras, candidatas = seleccionar(historias, info, ahora)
    res = {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'grupo_cuentas': len(grupo), 'grupo_vaults': len(lista_v), 'estado_vaults': estado_v, 'historiales': len(historias),
        'validacion': validacion, 'carteras': carteras, 'candidatas': candidatas, 'segundos': round(time.time() - t0, 1),
    }
    resumen = validacion.get('resumen', {})
    # lo que lee el servidor: pequeño y estable
    seleccion = {
        'version': 1, 'generado': res['generado'], 'usar_previa': bool(resumen.get('usar_previa', False)),
        'validacion': {k: resumen.get(k) for k in ('meses_estudiados', 'ic_puntuacion_media', 't_ic_puntuacion', 'ventaja_elegidas_pct_mes', 't_ventaja_elegidas')},
        'carteras': [{'direccion': c['direccion'], 't': c['t'], 'quincenas': c['quincenas'], 'tipo': c['tipo']} for c in carteras],
    }
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'traders.json'), 'w') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'seleccion.json'), 'w') as f:
        json.dump(seleccion, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(res))
    print(json.dumps({k: res[k] for k in ('grupo_cuentas', 'grupo_vaults', 'estado_vaults', 'historiales', 'candidatas', 'segundos')}), json.dumps(resumen))


if __name__ == '__main__':
    main()
