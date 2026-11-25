"""Prueba sin red del aprendizaje automático: en un mercado sin ventaja no aprende nada; con una plantada, sí."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.comun import MONEDAS_SERVIDOR  # noqa: E402
from lab.ml import paso_a_paso, preparar  # noqa: E402
from lab.sintetico import panel_sintetico  # noqa: E402
import pandas as pd  # noqa: E402


def _ic(mundo):
    panel = panel_sintetico(list(MONEDAS_SERVIDOR), horas=24 * 365 * 3, mundo=mundo, semilla=5)
    cols = list(range(len(panel['monedas'])))
    df, Xn, yn, feats = preparar(panel, cols)
    pred = paso_a_paso(df, Xn, yn).dropna()
    ic = pd.DataFrame({'p': pred, 'y': yn.reindex(pred.index)}).dropna().groupby(level=0).apply(lambda g: g['p'].corr(g['y'], method='spearman')).dropna()
    return ic.mean(), ic.mean() / (ic.std() / len(ic) ** 0.5)


def test_ruido_y_ventaja():
    ic, t = _ic('ruido')
    assert abs(t) < 3, (ic, t)
    ic, t = _ic('impulso')
    assert ic > 0.05 and t > 4, (ic, t)


if __name__ == '__main__':
    test_ruido_y_ventaja()
    print('OK    test_ruido_y_ventaja')
