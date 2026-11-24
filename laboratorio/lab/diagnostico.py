"""Comprobaciones de los datos y del simulador con datos reales (para revisar que nada está roto).
Uso: python -m lab.diagnostico --panel datos/panel.npz --resultados ../resultados"""
import argparse
import datetime as dt
import json
import math
import os

import numpy as np

from .comun import BANDA, COMISION, DESLIZAMIENTO, MONEDAS_SERVIDOR, VOL_OBJ_H
from .buscar import submemoria
from .datos import cargar_panel
from .estadistica import resumen_serie
from .senales import memoria, rejilla
from .simular import correr, diario, preparar, simular

H = 3_600_000
FECHAS_BTC = ['2021-11-10', '2022-06-18', '2022-11-21', '2024-03-14', '2025-01-20']


def fecha_ms(s):
    return int(dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', default='datos/panel.npz')
    ap.add_argument('--resultados', default='../resultados')
    a = ap.parse_args()
    panel = cargar_panel(a.panel)
    t, P, Fp, Fi = panel['t'], panel['P'], panel['Fpago'], panel['Finfo']
    monedas = panel['monedas']
    out = {'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'monedas': {}}
    anos_total = len(t) / 8760
    for j, m in enumerate(monedas):
        ok = P[:, j] > 0
        if not ok.any():
            out['monedas'][m] = {'horas': 0}
            continue
        i0, i1 = int(np.argmax(ok)), int(len(ok) - 1 - np.argmax(ok[::-1]))
        tramo = P[i0:i1 + 1, j]
        huecos = int(np.isnan(tramo).sum())
        with np.errstate(invalid='ignore', divide='ignore'):
            r = np.diff(np.log(tramo))
        r = r[np.isfinite(r)]
        fp = Fp[i0:i1 + 1, j]
        out['monedas'][m] = {
            'desde': dt.datetime.fromtimestamp(t[i0] / 1000, dt.timezone.utc).strftime('%Y-%m-%d'),
            'hasta': dt.datetime.fromtimestamp(t[i1] / 1000, dt.timezone.utc).strftime('%Y-%m-%d %H:00'),
            'horas': int(ok.sum()), 'huecos_internos': huecos,
            'max_mov_horario_pct': round(float(np.abs(r).max() * 100), 2) if r.size else None,
            'vol_anual_pct': round(float(r.std() * math.sqrt(8760) * 100), 1) if r.size > 10 else None,
            'funding_anual_medio_pct': round(float(fp.sum() / max((i1 - i0 + 1) / 8760, 1e-9) * 100), 2),
            'fuente': panel['fuente'].get(m, ''),
        }
    jb = monedas.index('BTC')
    out['btc_en_fechas'] = {}
    for s in FECHAS_BTC:
        k = (fecha_ms(s) - int(t[0])) // H
        if 0 <= k < len(t):
            out['btc_en_fechas'][s] = None if np.isnan(P[k, jb]) else round(float(P[k, jb]), 1)
    # referencias simuladas con las mismas reglas, con y sin costes
    M = memoria(panel)
    R, Fsig, hora = preparar(panel)
    cols = [monedas.index(m) for m in MONEDAS_SERVIDOR if m in monedas]
    Mu = submemoria(M, cols)
    Ru, Fu = R[:, cols], Fsig[:, cols]
    i_btc = [monedas[c] for c in cols].index('BTC')
    coste = COMISION + DESLIZAMIENTO
    todas = {e['id']: e for e in rejilla()}
    try:
        res = json.load(open(os.path.join(a.resultados, 'estrategias.json')))
    except Exception:
        res = {}
    ini = res.get('periodo', {}).get('desde')
    d_ini = (fecha_ms(ini) // 86_400_000) if ini else None
    referencias = {
        'siempre_comprado_20_monedas_escala_vol': 'siempre',
        'tendencia_semana_mes': todas.get('lab_cruce_168_720_s_ser_amb_nf_h1'),
        'cobrar_funding_cortos': todas.get('lab_funding_sigue_168_s_ser_cor_nf_h24'),
    }
    elegidas = [f['id'] for f in res.get('estrategias', [])[:6]]
    for i in elegidas:
        if i in todas:
            referencias[i] = todas[i]
    out['simulaciones'] = {}
    for nombre_r, e in referencias.items():
        if not e:
            continue
        filas = {}
        for etiqueta, c in (('con_costes', coste), ('sin_costes', 0.0)):
            if e == 'siempre':
                n = Mu['lista'].sum(axis=1).astype(float)
                with np.errstate(invalid='ignore', divide='ignore'):
                    obj = np.where(Mu['lista'], np.minimum(1.0, VOL_OBJ_H / Mu['sig']) / n[:, None], 0.0)
                obj = np.nan_to_num(obj)
                r, g = simular(obj, Ru, Fu, hora, 24, c, BANDA)
            else:
                r, g, obj = correr(dict(e), Mu, Ru, Fu, hora, i_btc, c)
            d, d0 = diario(r, t)
            if d_ini is not None:
                d = d[max(0, d_ini - d0):-1]
            s = resumen_serie(d)
            filas[etiqueta] = {k: round(v, 3) if isinstance(v, float) else v for k, v in s.items()}
            filas['giro_anual'] = round(float(g.sum() / anos_total), 1)
            filas['exposicion_media'] = round(float(np.abs(obj).sum(axis=1).mean()), 3)
        out['simulaciones'][nombre_r] = filas
    with open(os.path.join(a.resultados, 'diagnostico.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # resumen legible al final del informe
    l = ['\n## Comprobaciones\n', 'BTC en fechas conocidas: ' + ', '.join('%s %s' % (k, v) for k, v in out['btc_en_fechas'].items()) + '.\n',
         '| Simulación (20 monedas) | Rent. anual con costes | Sin costes | Sharpe con costes | Sin costes | Giro anual |', '|---|---|---|---|---|---|']
    for k, v in out['simulaciones'].items():
        c, s = v['con_costes'], v['sin_costes']
        if 'sharpe_anual' in c:
            l.append('| %s | %.1f %% | %.1f %% | %.2f | %.2f | %.0f |' % (k, c['rent_anual_pct'], s['rent_anual_pct'], c['sharpe_anual'], s['sharpe_anual'], v['giro_anual']))
    raros = [m for m, v in out['monedas'].items() if v.get('max_mov_horario_pct') and v['max_mov_horario_pct'] > 40]
    l.append('\nMonedas con algún movimiento horario de más del 40 %% (revisar empalmes): %s.\n' % (', '.join(raros) or 'ninguna'))
    with open(os.path.join(a.resultados, 'informe.md'), 'a') as f:
        f.write('\n'.join(l) + '\n')
    print(json.dumps({'btc': out['btc_en_fechas'], 'raros': raros}, ensure_ascii=False))


if __name__ == '__main__':
    main()
