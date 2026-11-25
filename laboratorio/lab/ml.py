"""Aprendizaje automático al estilo Qlib (Microsoft Research Asia, licencia MIT) adaptado a cripto.

En vez de reglas sueltas, un modelo (LightGBM) aprende a combinar indicadores para ordenar las monedas por lo que
subirán mañana. Indicadores inspirados en Alpha158 de Qlib (forma de la vela del día, rendimientos, medias,
volatilidad, máximos y mínimos, posición en el rango, días de subida, volumen y su relación con el precio) más
tres propios de cripto: funding, proporción de compras agresivas y relación con BTC.

Sin mirar al futuro: cada día se predice con un modelo entrenado solo con días anteriores (reentrenado cada 30 días,
paso a paso hacia delante). Todo lo que se publica es fuera de muestra.

Uso: python -m lab.ml --panel datos/panel.npz --salida ../resultados/ml
"""
import argparse
import datetime as dt
import json
import math
import os
import time

import numpy as np
import pandas as pd

from .comun import COMISION, DESLIZAMIENTO, MONEDAS_SERVIDOR
from .datos import cargar_panel
from .estadistica import resumen_serie, sharpe

VENTANAS = (5, 10, 20, 30, 60)
DIAS_INICIO = 730          # dos años para el primer entrenamiento
REENTRENO = 30
H = 3_600_000


def diario(panel, cols):
    """Barras diarias aproximadas a partir de los cierres horarios (abre = cierre de las 0 h; máximo y mínimo de los
    cierres horarios; volumen en $; compras agresivas en $; funding pagado en el día)."""
    t = pd.to_datetime(panel['t'], unit='ms', utc=True)
    dia = (t - pd.Timedelta(milliseconds=1)).floor('D')  # la hora que acaba a las 00:00 pertenece al día anterior
    out = {}
    for j in cols:
        m = panel['monedas'][j]
        df = pd.DataFrame({'c': panel['P'][:, j], 'v': panel['V'][:, j], 'tb': panel['TB'][:, j], 'f': panel['Fpago'][:, j]}, index=dia)
        g = df.groupby(level=0)
        d = pd.DataFrame({'open': g['c'].first(), 'high': g['c'].max(), 'low': g['c'].min(), 'close': g['c'].last(),
                          'vol': g['v'].sum(min_count=1), 'tb': g['tb'].sum(min_count=1), 'f': g['f'].sum(), 'n': g['c'].count()})
        d.loc[d['n'] < 20, ['open', 'high', 'low', 'close']] = np.nan  # días incompletos fuera
        out[m] = d
    return out


def indicadores(d, btc):
    """Indicadores de un día (sin usar nada posterior) para una moneda; d con open/high/low/close/vol/tb/f."""
    c, o, h, l, v = d['close'], d['open'], d['high'], d['low'], d['vol'].replace(0, np.nan)
    f = {}
    rng = (h - l).replace(0, np.nan)
    f['KMID'] = (c - o) / o
    f['KLEN'] = (h - l) / o
    f['KMID2'] = (c - o) / rng
    f['KUP'] = (h - np.maximum(o, c)) / o
    f['KLOW'] = (np.minimum(o, c) - l) / o
    f['KSFT'] = (2 * c - h - l) / o
    r1 = c.pct_change(fill_method=None)
    rb = btc['close'].pct_change(fill_method=None).reindex(c.index)
    lv = np.log(v)
    for w in VENTANAS:
        f['ROC%d' % w] = c.shift(w) / c
        f['MA%d' % w] = c.rolling(w).mean() / c
        f['STD%d' % w] = c.rolling(w).std() / c
        f['MAX%d' % w] = h.rolling(w).max() / c
        f['MIN%d' % w] = l.rolling(w).min() / c
        f['QTLU%d' % w] = c.rolling(w).quantile(0.8) / c
        f['QTLD%d' % w] = c.rolling(w).quantile(0.2) / c
        f['RSV%d' % w] = (c - l.rolling(w).min()) / (h.rolling(w).max() - l.rolling(w).min() + 1e-12)
        f['IMAX%d' % w] = h.rolling(w).apply(np.argmax, raw=True) / w
        f['IMIN%d' % w] = l.rolling(w).apply(np.argmin, raw=True) / w
        f['CNTP%d' % w] = (r1 > 0).astype(float).rolling(w).mean()
        f['SUMP%d' % w] = r1.clip(lower=0).rolling(w).sum() / (r1.abs().rolling(w).sum() + 1e-12)
        f['VMA%d' % w] = v.rolling(w).mean() / (v + 1e-12)
        f['VSTD%d' % w] = v.rolling(w).std() / (v + 1e-12)
        f['CORR%d' % w] = c.rolling(w).corr(lv)
        f['CORD%d' % w] = r1.rolling(w).corr(lv.diff())
        f['BETA%d' % w] = r1.rolling(w).cov(rb) / (rb.rolling(w).var() + 1e-12)
        f['VOLT%d' % w] = r1.rolling(w).std()
    # propios de cripto
    f['FUND1'] = d['f']
    f['FUND7'] = d['f'].rolling(7).mean()
    f['TAKER1'] = d['tb'] / (d['vol'] + 1e-12)
    f['TAKER7'] = d['tb'].rolling(7).sum() / (d['vol'].rolling(7).sum() + 1e-12)
    f['TURN7'] = np.log(d['vol'].rolling(7).mean() + 1)
    return pd.DataFrame(f).replace([np.inf, -np.inf], np.nan)


def rango_seccion(x):
    """Normaliza cada día por rangos entre monedas (como CSRankNorm de Qlib): de -0,5 a 0,5."""
    return x.groupby(level=0).rank(pct=True) - 0.5


def preparar(panel, cols):
    dd = diario(panel, cols)
    btc = dd.get('BTC')
    if btc is None:
        raise SystemExit('Falta BTC')
    filas = []
    for m, d in dd.items():
        X = indicadores(d, btc)
        y = d['close'].shift(-1) / d['close'] - 1          # de hoy al cierre de mañana: lo que se gana si se entra hoy
        X['_y'] = y
        X['_moneda'] = m
        X['_vivo'] = d['close'].notna() & (d['n'] >= 20)
        filas.append(X)
    df = pd.concat(filas)
    df.index.name = 'dia'
    df = df.reset_index().set_index(['dia', '_moneda']).sort_index()
    df = df[df['_vivo']]
    # una moneda entra cuando lleva 60 días de historia (los indicadores de 60 días ya existen)
    df = df[df['ROC60'].notna()]
    feats = [c for c in df.columns if not c.startswith('_')]
    Xn = rango_seccion(df[feats])
    yn = rango_seccion(df[['_y']])['_y']
    return df, Xn, yn, feats


def entrenar(X, y, semilla):
    try:
        import lightgbm as lgb
        m = lgb.LGBMRegressor(n_estimators=300, learning_rate=0.03, num_leaves=31, min_child_samples=200,
                              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0,
                              random_state=semilla, verbose=-1)
        m.fit(X, y)
        return m
    except ImportError:  # sin LightGBM: regresión lineal con contracción
        from numpy.linalg import solve
        A = np.nan_to_num(X.values)
        w = solve(A.T @ A + 10.0 * np.eye(A.shape[1]), A.T @ np.nan_to_num(y.values))
        class Lineal:
            def predict(self, Z):
                return np.nan_to_num(Z.values) @ w
        return Lineal()


def paso_a_paso(df, Xn, yn, semilla=7):
    dias = sorted(df.index.get_level_values(0).unique())
    pred = pd.Series(np.nan, index=df.index)
    modelo, ultimo = None, None
    for k in range(DIAS_INICIO, len(dias)):
        d = dias[k]
        if modelo is None or (d - ultimo).days >= REENTRENO:
            # se entrena con días cuyo resultado ya se conoce: el de ayer termina hoy, así que hasta d-1
            entreno = Xn.index.get_level_values(0) < d
            ok = entreno & yn.notna()
            modelo = entrenar(Xn[ok], yn[ok], semilla)
            ultimo = d
        hoy = Xn.index.get_level_values(0) == d
        if hoy.any():
            pred[hoy] = modelo.predict(Xn[hoy])
    return pred


def cartera(df, pred, k, modo, coste):
    """Cada día: compra las k de mejor predicción (y vende las k peores si modo='largo_corto'), a partes iguales.
    Devuelve el rendimiento diario neto de costes y el giro medio."""
    datos = pd.DataFrame({'p': pred, 'y': df['_y']}).dropna(subset=['p'])
    dias = sorted(datos.index.get_level_values(0).unique())
    previo, r, giros = {}, [], []
    for d in dias:
        x = datos.loc[d].dropna(subset=['y'])
        if len(x) < 2 * k:
            r.append(0.0); giros.append(0.0); previo = {}
            continue
        orden = x['p'].sort_values()
        w = {}
        for m in orden.index[-k:]:
            w[m] = (0.5 if modo == 'largo_corto' else 1.0) / k
        if modo == 'largo_corto':
            for m in orden.index[:k]:
                w[m] = -0.5 / k
        g = sum(abs(w.get(m, 0) - previo.get(m, 0)) for m in set(w) | set(previo))
        r.append(sum(w[m] * x.loc[m, 'y'] for m in w) - g * coste)
        giros.append(g)
        previo = w
    return pd.Series(r, index=dias), float(np.mean(giros)) if giros else 0.0


def evaluar(panel, cols, nombre, coste):
    t0 = time.time()
    df, Xn, yn, feats = preparar(panel, cols)
    pred = paso_a_paso(df, Xn, yn)
    oos = pred.dropna()
    ic = pd.DataFrame({'p': oos, 'y': yn.reindex(oos.index)}).dropna().groupby(level=0).apply(lambda g: g['p'].corr(g['y'], method='spearman') if len(g) > 4 else np.nan).dropna()
    res = {'universo': nombre, 'monedas': len(cols), 'indicadores': len(feats), 'dias_fuera_de_muestra': int(oos.index.get_level_values(0).nunique()),
           'ic_medio': round(float(ic.mean()), 4), 't_ic': round(float(ic.mean() / (ic.std(ddof=1) / math.sqrt(len(ic)))) if len(ic) > 2 else 0.0, 2),
           'ic_positivo_pct': round(float((ic > 0).mean() * 100), 1), 'carteras': {}}
    for k in (3, 5):
        for modo in ('largo_corto', 'solo_compras'):
            serie, giro = cartera(df, pred, k, modo, coste)
            s = resumen_serie(serie.values)
            bruto, _ = cartera(df, pred, k, modo, 0.0)
            res['carteras']['%s_k%d' % (modo, k)] = {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in s.items()}
            res['carteras']['%s_k%d' % (modo, k)]['giro_diario'] = round(giro, 3)
            res['carteras']['%s_k%d' % (modo, k)]['sharpe_sin_costes'] = round(float(sharpe(bruto.values) * math.sqrt(365)), 3)
    # referencia: todas las monedas a partes iguales (comprado)
    eq = df['_y'].groupby(level=0).mean().reindex(sorted(oos.index.get_level_values(0).unique()))
    res['referencia_todas_a_partes_iguales'] = {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in resumen_serie(eq.fillna(0).values).items()}
    res['desde'] = str(oos.index.get_level_values(0).min().date()) if len(oos) else None
    res['segundos'] = round(time.time() - t0, 1)
    return res


def informe(r):
    l = ['# Aprendizaje automático (estilo Qlib) — todo fuera de muestra\n',
         '> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con %d indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada %d días solo con el pasado. Investigación en papel.\n' % (r['resultados'][0]['indicadores'] if r['resultados'] else 0, REENTRENO)]
    for x in r['resultados']:
        l.append('## Universo: %s (%d monedas), desde %s (%d días fuera de muestra)\n' % (x['universo'], x['monedas'], x['desde'], x['dias_fuera_de_muestra']))
        l.append('- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **%.3f** (t = %.1f); positivo el %.0f %% de los días. 0 = no sabe nada.' % (x['ic_medio'], x['t_ic'], x['ic_positivo_pct']))
        ref = x['referencia_todas_a_partes_iguales']
        l.append('- Referencia (todas comprado a partes iguales): %.1f %% al año, Sharpe %.2f, caída máxima %.1f %%.\n' % (ref.get('rent_anual_pct', 0), ref.get('sharpe_anual', 0), ref.get('caida_max_pct', 0)))
        l.append('| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |')
        l.append('|---|---|---|---|---|---|')
        for nombre, c in x['carteras'].items():
            l.append('| %s | %.1f %% | %.2f | %.2f | %.1f %% | %.2f |' % (nombre.replace('_', ' '), c.get('rent_anual_pct', 0), c.get('sharpe_anual', 0), c.get('sharpe_sin_costes', 0), c.get('caida_max_pct', 0), c.get('giro_diario', 0)))
        l.append('')
    l.append('Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría); 8 variantes de cartera probadas: con tan pocas, el listón contra la suerte es bajo, pero hay que confirmarlo en vivo.')
    return '\n'.join(l) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', default='datos/panel.npz')
    ap.add_argument('--salida', default='../resultados/ml')
    a = ap.parse_args()
    panel = cargar_panel(a.panel)
    monedas = panel['monedas']
    coste = COMISION + DESLIZAMIENTO
    universos = [('servidor', [monedas.index(m) for m in MONEDAS_SERVIDOR if m in monedas]), ('amplio', list(range(len(monedas))))]
    out = {'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'coste_por_giro_pct': round(coste * 100, 3), 'resultados': []}
    for nombre, cols in universos:
        out['resultados'].append(evaluar(panel, cols, nombre, coste))
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'ml.json'), 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1, default=str)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(out))
    print(json.dumps([{k: x[k] for k in ('universo', 'ic_medio', 't_ic', 'segundos')} for x in out['resultados']]))


if __name__ == '__main__':
    main()
