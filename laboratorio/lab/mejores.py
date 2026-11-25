"""Aprender de los mejores (con datos): ¿los operadores que más ganan en Hyperliquid siguen ganando después?

Datos públicos, sin clave:
- ranking de Hyperliquid (stats-data.hyperliquid.xyz/Mainnet/leaderboard): todas las cuentas con su valor y su
  resultado por día, semana, mes y total;
- historial de cada cuenta (info API, `portfolio`): su valor y su resultado acumulado a lo largo del tiempo.

Para no elegir con lo que se sabe hoy (sesgo de supervivencia), el grupo de estudio no son los que más han ganado,
sino los que más han OPERADO (volumen acumulado): ahí están también los que perdieron.
Luego, mes a mes y con la información de ese momento: ¿los mejores de un mes son mejores el mes siguiente?

Uso: python -m lab.mejores --salida ../resultados/mejores [--grupo 400]
"""
import argparse
import datetime as dt
import json
import math
import os
import time

import numpy as np

from .datos import _http, hl

RANKING = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'
DIA = 86_400_000


def ranking():
    estado, b = _http(RANKING, intentos=4, timeout=120)
    if estado != 200 or not b:
        raise SystemExit('No se pudo leer el ranking de Hyperliquid (%s)' % estado)
    j = json.loads(b)
    filas = j.get('leaderboardRows', j if isinstance(j, list) else [])
    out = []
    for r in filas:
        try:
            ventanas = {w: d for w, d in r.get('windowPerformances', [])}
            total = ventanas.get('allTime', {})
            mes = ventanas.get('month', {})
            out.append({
                'direccion': r['ethAddress'].lower(),
                'valor': float(r.get('accountValue') or 0),
                'pnl_total': float(total.get('pnl') or 0),
                'roi_total': float(total.get('roi') or 0),
                'vlm_total': float(total.get('vlm') or 0),
                'pnl_mes': float(mes.get('pnl') or 0),
                'roi_mes': float(mes.get('roi') or 0),
                'vlm_mes': float(mes.get('vlm') or 0),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return out


def historial(direccion):
    """Valor de la cuenta y resultado acumulado (todo su historial) de una cuenta: dos series [(t, v)]."""
    r = hl({'type': 'portfolio', 'user': direccion}, peso=20)
    if not r:
        return None
    ventanas = {w: d for w, d in r} if isinstance(r, list) else {}
    d = ventanas.get('perpAllTime') or ventanas.get('allTime')
    if not d:
        return None
    av = [(int(t), float(v)) for t, v in d.get('accountValueHistory', [])]
    pnl = [(int(t), float(v)) for t, v in d.get('pnlHistory', [])]
    return {'valor': av, 'pnl': pnl}


def en(serie, t):
    """Último valor de la serie en o antes de t (None si no hay)."""
    v = None
    for ti, x in serie:
        if ti <= t:
            v = x
        else:
            break
    return v


def fines_de_mes(desde_ms, hasta_ms):
    d = dt.datetime.fromtimestamp(desde_ms / 1000, dt.timezone.utc).date().replace(day=1)
    out = []
    while True:
        d = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        ms = int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp() * 1000)
        if ms > hasta_ms:
            break
        out.append(ms)
    return out


def spearman(a, b):
    ra = np.argsort(np.argsort(a)).astype(float)
    rb = np.argsort(np.argsort(b)).astype(float)
    if ra.std() == 0 or rb.std() == 0:
        return 0.0
    return float(np.corrcoef(ra, rb)[0, 1])


def estudiar(historias, min_valor=10_000.0, min_cuentas=40):
    """Mes a mes: rendimiento de cada cuenta (resultado del mes / valor al empezar el mes). ¿El de este mes predice el
    del siguiente? Solo cuentas con al menos min_valor al empezar el mes (las diminutas tienen rendimientos absurdos)."""
    todos_t = [t for h in historias.values() for t, _ in h['pnl']]
    if not todos_t:
        return {'meses': []}
    cortes = fines_de_mes(min(todos_t), max(todos_t))
    rend = {}  # (direccion, k) -> rendimiento del mes que acaba en cortes[k]
    for d, h in historias.items():
        for k in range(1, len(cortes)):
            v0 = en(h['valor'], cortes[k - 1])
            p0, p1 = en(h['pnl'], cortes[k - 1]), en(h['pnl'], cortes[k])
            if v0 is None or p0 is None or p1 is None or v0 < min_valor:
                continue
            rend[(d, k)] = (p1 - p0) / v0
    meses = []
    for k in range(1, len(cortes) - 1):
        comunes = [d for d in historias if (d, k) in rend and (d, k + 1) in rend]
        if len(comunes) < min_cuentas:
            continue
        a = np.array([rend[(d, k)] for d in comunes])
        b = np.array([rend[(d, k + 1)] for d in comunes])
        a_c, b_c = np.clip(a, -1, 5), np.clip(b, -1, 5)  # sin que una cuenta extrema decida la media
        corte = np.quantile(a_c, 0.9)
        arriba = a_c >= corte
        meses.append({
            'mes_eleccion': dt.datetime.fromtimestamp(cortes[k] / 1000, dt.timezone.utc).strftime('%Y-%m'),
            'cuentas': len(comunes),
            'correlacion_rangos': round(spearman(a_c, b_c), 3),
            'mejores_10pct_mes_siguiente_pct': round(float(np.mean(b_c[arriba])) * 100, 2),
            'resto_mes_siguiente_pct': round(float(np.mean(b_c[~arriba])) * 100, 2),
            'mejores_10pct_ganan_siguiente_pct': round(float(np.mean(b_c[arriba] > 0)) * 100, 1),
            'resto_ganan_siguiente_pct': round(float(np.mean(b_c[~arriba] > 0)) * 100, 1),
            'todos_ganan_este_mes_pct': round(float(np.mean(a_c > 0)) * 100, 1),
        })
    res = {'meses': meses}
    if meses:
        c = np.array([m['correlacion_rangos'] for m in meses])
        dif = np.array([m['mejores_10pct_mes_siguiente_pct'] - m['resto_mes_siguiente_pct'] for m in meses])
        res['resumen'] = {
            'meses_estudiados': len(meses),
            'correlacion_media': round(float(c.mean()), 3),
            't_correlacion': round(float(c.mean() / (c.std(ddof=1) / math.sqrt(len(c)))) if len(c) > 1 and c.std() > 0 else 0.0, 2),
            'ventaja_mejores_vs_resto_pct_mes': round(float(dif.mean()), 2),
            't_ventaja': round(float(dif.mean() / (dif.std(ddof=1) / math.sqrt(len(dif)))) if len(dif) > 1 and dif.std() > 0 else 0.0, 2),
            'meses_con_ventaja_pct': round(float((dif > 0).mean() * 100), 1),
        }
    return res


def informe(r):
    l = ['# Aprender de los mejores: ¿los que ganan en Hyperliquid siguen ganando?\n',
         '> Datos públicos de Hyperliquid (ranking e historial de cada cuenta). Investigación en papel; no es una recomendación.\n',
         '- Generado: %s.' % r['generado'],
         '- Cuentas en el ranking: %d. Grupo de estudio: las %d con más volumen acumulado (incluye las que perdieron), con al menos %s $ al empezar cada mes.' % (r['ranking_total'], r['grupo'], format(int(r['min_valor']), ',').replace(',', '.')),
         '- Historiales leídos: %d.\n' % r['historiales']]
    e = r['estudio']
    if 'resumen' in e:
        s = e['resumen']
        l.append('## Resultado\n')
        l.append('- Meses estudiados: %d.' % s['meses_estudiados'])
        l.append('- Correlación entre el puesto de un mes y el del siguiente: **%.2f** de media (t = %.1f). 0 = no hay relación; 1 = siempre el mismo orden.' % (s['correlacion_media'], s['t_correlacion']))
        l.append('- El 10 % mejor de un mes rinde el mes siguiente **%+.2f puntos** frente al resto (t = %.1f); tiene ventaja en el %.0f %% de los meses.\n' % (s['ventaja_mejores_vs_resto_pct_mes'], s['t_ventaja'], s['meses_con_ventaja_pct']))
        l.append('| Mes de elección | Cuentas | Correlación | 10 % mejor, mes siguiente | Resto, mes siguiente | 10 % mejor que gana | Resto que gana |')
        l.append('|---|---|---|---|---|---|---|')
        for m in e['meses']:
            l.append('| %s | %d | %.2f | %+.2f %% | %+.2f %% | %.0f %% | %.0f %% |' % (m['mes_eleccion'], m['cuentas'], m['correlacion_rangos'], m['mejores_10pct_mes_siguiente_pct'], m['resto_mes_siguiente_pct'], m['mejores_10pct_ganan_siguiente_pct'], m['resto_ganan_siguiente_pct']))
    else:
        l.append('No hubo suficientes cuentas con historial para estudiar ningún mes.')
    l.append('\n## Los que más han ganado en total (hoy)\n')
    l.append('| Cuenta | Valor | Ganancia total | Ganancia del mes | Volumen total |')
    l.append('|---|---|---|---|---|')
    for c in r['top_ganancia'][:15]:
        l.append('| %s…%s | %.0f $ | %.0f $ | %.0f $ | %.0f M$ |' % (c['direccion'][:6], c['direccion'][-4:], c['valor'], c['pnl_total'], c['pnl_mes'], c['vlm_total'] / 1e6))
    return '\n'.join(l) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='../resultados/mejores')
    ap.add_argument('--grupo', type=int, default=400)
    ap.add_argument('--min-valor', type=float, default=10_000.0)
    a = ap.parse_args()
    t0 = time.time()
    filas = ranking()
    filas.sort(key=lambda r: -r['vlm_total'])
    grupo = filas[: a.grupo]
    historias, muestra = {}, None
    for i, c in enumerate(grupo):
        h = historial(c['direccion'])
        if h and h['pnl'] and h['valor']:
            historias[c['direccion']] = h
            if muestra is None:
                muestra = {'puntos_pnl': len(h['pnl']), 'primero': h['pnl'][:3], 'ultimo': h['pnl'][-3:]}
    estudio = estudiar(historias, min_valor=a.min_valor)
    res = {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'ranking_total': len(filas), 'grupo': len(grupo), 'historiales': len(historias), 'min_valor': a.min_valor,
        'estudio': estudio, 'muestra_formato': muestra,
        'top_ganancia': sorted(filas, key=lambda r: -r['pnl_total'])[:50],
        'segundos': round(time.time() - t0, 1),
    }
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'mejores.json'), 'w') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(res))
    print(json.dumps({k: res[k] for k in ('ranking_total', 'grupo', 'historiales', 'segundos')}), json.dumps(estudio.get('resumen', {})))


if __name__ == '__main__':
    main()
