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


def preparar_dd(dd, miembros=None, btc='BTC'):
    """dd: {moneda: barras diarias}. miembros (opcional): {moneda: Serie de días en que la moneda está en el universo}.
    Si una moneda trae la columna 'y', se usa como rendimiento del día siguiente (p. ej. con la regla de las retiradas)."""
    b = dd.get(btc)
    if b is None:
        raise SystemExit('Falta ' + btc)
    filas = []
    for m, d in dd.items():
        X = indicadores(d, b)
        y = d['y'] if 'y' in d.columns else d['close'].shift(-1) / d['close'] - 1  # de hoy al cierre de mañana
        X['_y'] = y
        X['_y2'] = y.shift(-1)  # entrando un día más tarde: si la ventaja sigue, no es un efecto del precio de cierre
        X['_moneda'] = m
        vivo = d['close'].notna()
        if 'n' in d.columns:
            vivo &= d['n'] >= 20
        if miembros is not None:
            vivo &= miembros[m].reindex(d.index).fillna(False).astype(bool) if m in miembros else False
        X['_vivo'] = vivo
        filas.append(X)
    df = pd.concat(filas)
    df.index.name = 'dia'
    df = df.reset_index().set_index(['dia', '_moneda']).sort_index()
    df = df[df['_vivo'].astype(bool)]
    # una moneda entra cuando lleva 60 días de historia (los indicadores de 60 días ya existen)
    df = df[df['ROC60'].notna()]
    feats = [c for c in df.columns if not c.startswith('_')]
    Xn = rango_seccion(df[feats])
    yn = rango_seccion(df[['_y']])['_y']
    return df, Xn, yn, feats


def preparar(panel, cols):
    return preparar_dd(diario(panel, cols))


def entrenar(X, y, semilla):
    try:
        import lightgbm as lgb  # interfaz propia de LightGBM: no necesita scikit-learn
        params = dict(objective='regression', learning_rate=0.03, num_leaves=31, min_data_in_leaf=200,
                      bagging_fraction=0.8, bagging_freq=1, feature_fraction=0.8, lambda_l2=1.0,
                      seed=semilla, deterministic=True, verbose=-1)
        return lgb.train(params, lgb.Dataset(X, label=y), num_boost_round=300)
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


def _elegir(orden, k, salida, tenidos):
    """Las k primeras de `orden`; con banda, primero se quedan las que ya se tenían y siguen entre las `salida` primeras."""
    if not salida:
        return list(orden[:k])
    quedan = [m for m in orden[:salida] if m in tenidos][:k]
    return quedan + [m for m in orden if m not in quedan][:k - len(quedan)]


def cartera(df, pred, k, modo, coste, salida=None, col='_y'):
    """Cada día: compra las k de mejor predicción (y vende las k peores si modo='largo_corto'), a partes iguales.
    Con `salida`, una moneda se mantiene mientras siga entre las `salida` mejores (o peores): mucho menos giro.
    Devuelve el rendimiento diario neto de costes y el giro medio."""
    datos = pd.DataFrame({'p': pred, 'y': df[col]}).dropna(subset=['p'])
    dias = sorted(datos.index.get_level_values(0).unique())
    previo, r, giros = {}, [], []
    for d in dias:
        x = datos.loc[d].dropna(subset=['y'])
        if len(x) < 2 * k:
            r.append(0.0); giros.append(0.0); previo = {}
            continue
        orden = list(x['p'].sort_values().index)
        w = {}
        for m in _elegir(orden[::-1], k, salida, {m for m, v in previo.items() if v > 0}):
            w[m] = (0.5 if modo == 'largo_corto' else 1.0) / k
        if modo == 'largo_corto':
            for m in _elegir(orden, k, salida, {m for m, v in previo.items() if v < 0}):
                if m not in w:
                    w[m] = -0.5 / k
        g = sum(abs(w.get(m, 0) - previo.get(m, 0)) for m in set(w) | set(previo))
        r.append(sum(w[m] * x.loc[m, 'y'] for m in w) - g * coste)
        giros.append(g)
        previo = w
    return pd.Series(r, index=dias), float(np.mean(giros)) if giros else 0.0


CARTERAS = [  # (nombre, k, modo, salida, columna): 8 variantes fijadas de antemano
    ('largo_corto_k3', 3, 'largo_corto', None, '_y'), ('solo_compras_k3', 3, 'solo_compras', None, '_y'),
    ('largo_corto_k5', 5, 'largo_corto', None, '_y'), ('solo_compras_k5', 5, 'solo_compras', None, '_y'),
    ('lenta_largo_corto_k5', 5, 'largo_corto', 15, '_y'), ('lenta_solo_compras_k5', 5, 'solo_compras', 15, '_y'),
    ('lenta_largo_corto_k5_un_dia_tarde', 5, 'largo_corto', 15, '_y2'), ('lenta_solo_compras_k5_un_dia_tarde', 5, 'solo_compras', 15, '_y2'),
]


def _ic(pred, y):
    ic = pd.DataFrame({'p': pred, 'y': y.reindex(pred.index)}).dropna().groupby(level=0).apply(
        lambda g: g['p'].corr(g['y'], method='spearman') if len(g) > 4 else np.nan).dropna()
    t = float(ic.mean() / (ic.std(ddof=1) / math.sqrt(len(ic)))) if len(ic) > 2 else 0.0
    return ic, t


def evaluar_df(df, Xn, yn, feats, nombre, coste):
    t0 = time.time()
    pred = paso_a_paso(df, Xn, yn)
    oos = pred.dropna()
    ic, t_ic = _ic(oos, yn)
    ic2, t_ic2 = _ic(oos, rango_seccion(df[['_y2']])['_y2'])
    res = {'universo': nombre, 'monedas': int(df.index.get_level_values(1).nunique()), 'indicadores': len(feats),
           'dias_fuera_de_muestra': int(oos.index.get_level_values(0).nunique()),
           'ic_medio': round(float(ic.mean()), 4), 't_ic': round(t_ic, 2), 'ic_positivo_pct': round(float((ic > 0).mean() * 100), 1),
           'ic_un_dia_tarde': round(float(ic2.mean()), 4), 't_ic_un_dia_tarde': round(t_ic2, 2),
           'monedas_por_dia': round(float(df.loc[oos.index.get_level_values(0).unique()].groupby(level=0).size().mean()), 1) if len(oos) else 0,
           'carteras': {}}
    for nombre_c, k, modo, salida, col in CARTERAS:
        serie, giro = cartera(df, pred, k, modo, coste, salida, col)
        s = resumen_serie(serie.values)
        bruto, _ = cartera(df, pred, k, modo, 0.0, salida, col)
        c = {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in s.items()}
        c['giro_diario'] = round(giro, 3)
        c['sharpe_sin_costes'] = round(float(sharpe(bruto.values) * math.sqrt(365)), 3)
        res['carteras'][nombre_c] = c
    # referencia: todas las monedas del universo a partes iguales (comprado)
    eq = df['_y'].groupby(level=0).mean().reindex(sorted(oos.index.get_level_values(0).unique()))
    res['referencia_todas_a_partes_iguales'] = {k2: (round(v, 3) if isinstance(v, float) else v) for k2, v in resumen_serie(eq.fillna(0).values).items()}
    res['desde'] = str(oos.index.get_level_values(0).min().date()) if len(oos) else None
    res['segundos'] = round(time.time() - t0, 1)
    return res


def evaluar_dd(dd, miembros, nombre, coste, btc='BTC'):
    t0 = time.time()
    df, Xn, yn, feats = preparar_dd(dd, miembros, btc)
    r = evaluar_df(df, Xn, yn, feats, nombre, coste)
    r['segundos'] = round(time.time() - t0, 1)
    return r


def evaluar(panel, cols, nombre, coste):
    t0 = time.time()
    df, Xn, yn, feats = preparar(panel, cols)
    r = evaluar_df(df, Xn, yn, feats, nombre, coste)
    r['monedas'] = len(cols)
    r['segundos'] = round(time.time() - t0, 1)
    return r


def informe(r, titulo='Aprendizaje automático (estilo Qlib) — todo fuera de muestra', nota=None):
    l = ['# %s\n' % titulo,
         '> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con %d indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada %d días solo con el pasado. Coste por cada 100 %% de giro: %.3f %%. Investigación en papel.\n' % (
             r['resultados'][0]['indicadores'] if r['resultados'] else 0, REENTRENO, r.get('coste_por_giro_pct', 0))]
    for x in r['resultados']:
        l.append('## Universo: %s (%d monedas), desde %s (%d días fuera de muestra)\n' % (x['universo'], x['monedas'], x['desde'], x['dias_fuera_de_muestra']))
        l.append('- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **%.3f** (t = %.1f); positivo el %.0f %% de los días. 0 = no sabe nada.' % (x['ic_medio'], x['t_ic'], x['ic_positivo_pct']))
        if 'ic_un_dia_tarde' in x:
            l.append('- Entrando un día más tarde: IC %.3f (t = %.1f). Si se mantiene, la ventaja no depende del precio exacto de cierre.' % (x['ic_un_dia_tarde'], x['t_ic_un_dia_tarde']))
        ref = x['referencia_todas_a_partes_iguales']
        l.append('- Referencia (todas comprado a partes iguales): %.1f %% al año, Sharpe %.2f, caída máxima %.1f %%.\n' % (ref.get('rent_anual_pct', 0), ref.get('sharpe_anual', 0), ref.get('caida_max_pct', 0)))
        l.append('| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |')
        l.append('|---|---|---|---|---|---|')
        for nombre, c in x['carteras'].items():
            l.append('| %s | %.1f %% | %.2f | %.2f | %.1f %% | %.2f |' % (nombre.replace('_', ' '), c.get('rent_anual_pct', 0), c.get('sharpe_anual', 0), c.get('sharpe_sin_costes', 0), c.get('caida_max_pct', 0), c.get('giro_diario', 0)))
        l.append('')
    l.append('«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. '
             '«Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.\n')
    l.append(nota or 'Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.')
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
