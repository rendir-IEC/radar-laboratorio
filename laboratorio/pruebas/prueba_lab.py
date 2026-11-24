"""Pruebas del laboratorio (sin red). Uso, desde laboratorio/: python -m pytest -q pruebas  o  python pruebas/prueba_lab.py"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab.comun import H, MONEDAS_SERVIDOR, SPANS  # noqa: E402
from lab.estadistica import deflactado, pbo_cscv, resumen_serie  # noqa: E402
from lab.senales import _memoria, memoria, objetivo, rejilla  # noqa: E402
from lab.simular import diario, simular  # noqa: E402
from lab.sintetico import panel_sintetico  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))


def test_memoria_igual_que_el_servidor():
    """Las EMAs, la varianza y el funding medio del laboratorio coinciden con los de servidor/worker.js."""
    rng = np.random.default_rng(1)
    T = 900
    t = (1_700_000_000_000 // H) * H + H * np.arange(T)
    P = np.exp(np.cumsum(rng.normal(0, 0.01, (T, 3)), axis=0)) * [100, 20, 3]
    P[100:105, 1] = np.nan       # hueco de 5 horas en una moneda (la v2.2 del servidor cuenta las horas de cada moneda)
    P[:50, 2] = np.nan           # moneda que empieza tarde
    F = rng.normal(1e-5, 5e-6, (T, 3))
    F[np.isnan(P)] = np.nan
    monedas = ['BTC', 'ETH', 'SOL']
    ent = {'t': t.tolist(), 'P': {m: [None if np.isnan(x) else float(x) for x in P[:, j]] for j, m in enumerate(monedas)},
           'F': {m: [None if np.isnan(x) else float(x) for x in F[:, j]] for j, m in enumerate(monedas)}}
    r = subprocess.run(['node', os.path.join(AQUI, 'memoria_servidor.mjs')], input=json.dumps(ent), capture_output=True, text=True, check=True)
    js = json.loads(r.stdout)
    EMA, V2, FE24, FE168, NH = _memoria(P, F, np.array(SPANS, dtype=np.float64))
    peor = 0.0
    for k in range(T):
        for j, m in enumerate(monedas):
            if np.isnan(P[k, j]):
                continue
            c = js[k][m]
            for s in range(len(SPANS)):
                peor = max(peor, abs(c['ema'][s] - EMA[s, k, j]))
            if c['v2'] is not None:
                peor = max(peor, abs(c['v2'] - V2[k, j]) / max(c['v2'], 1e-12) * 1e-6)
            peor = max(peor, abs(c['fe24'] - FE24[k, j]), abs(c['fe168'] - FE168[k, j]))
            assert c['n'] == NH[k, j], (k, m, c['n'], NH[k, j])
    assert peor < 1e-9, peor


def test_posiciones_iguales_que_el_servidor():
    """Para una muestra de estrategias de la rejilla, el servidor (apLabPosiciones) da las mismas posiciones que el laboratorio."""
    rng = np.random.default_rng(3)
    T = 1000
    t = (1_700_000_000_000 // H) * H + H * np.arange(T)
    monedas = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB']
    P = np.exp(np.cumsum(rng.normal(0, 0.01, (T, len(monedas))), axis=0)) * 50
    F = rng.normal(1e-5, 2e-5, (T, len(monedas)))
    todas = rejilla()
    muestra = [todas[i] for i in rng.choice(len(todas), 60, replace=False)]
    specs = [{k: e[k] for k in ('senal', 'a', 'b', 'forma', 'k', 'modo', 'lado', 'filtro', 'cada') if k in e} for e in muestra]
    ent = {'t': t.tolist(), 'P': {m: P[:, j].tolist() for j, m in enumerate(monedas)}, 'F': {m: F[:, j].tolist() for j, m in enumerate(monedas)}, 'specs': specs}
    r = subprocess.run(['node', os.path.join(AQUI, 'memoria_servidor.mjs')], input=json.dumps(ent), capture_output=True, text=True, check=True)
    js = json.loads(r.stdout)
    if js['posiciones'] is None:
        print('       (este servidor no tiene expertos del laboratorio: se omite)')
        return
    panel = {'t': t, 'P': P, 'Finfo': F}
    M = memoria(panel)
    peor = 0.0
    for e, pos in zip(muestra, js['posiciones']):
        obj = objetivo(e, M, 0)[-1]
        for j, m in enumerate(monedas):
            peor = max(peor, abs(obj[j] - (pos or {}).get(m, 0.0)))
    assert peor < 1e-9, peor


def test_sin_mirar_al_futuro():
    """La posición decidida en t solo gana el rendimiento de t a t+1, y se paga comisión al cambiarla."""
    T, N = 5, 1
    obj = np.zeros((T, N)); obj[1, 0] = 0.5; obj[2, 0] = 0.5
    R = np.zeros((T, N)); R[1, 0] = 0.10; R[0, 0] = 0.30
    F = np.zeros((T, N)); F[2, 0] = 0.001
    r, g = simular(obj, R, F, np.arange(T), 1, 0.001, 0.25)
    assert abs(r[0]) < 1e-12                       # sin posición en 0, no gana el 30 %
    assert abs(r[1] - (0.5 * 0.10 - 0.5 * 0.001)) < 1e-12
    assert abs(r[2] - (-0.5 * 0.001)) < 1e-12      # paga el funding de la hora siguiente
    assert abs(r[3] - (-0.5 * 0.001)) < 1e-12      # cierra: comisión


def test_banda_y_reajuste_diario():
    T, N = 48, 1
    obj = np.full((T, N), 0.10); obj[5:, 0] = 0.11   # cambio < 25 %: no se toca
    r, g = simular(obj, np.zeros((T, N)), np.zeros((T, N)), np.arange(T) % 24, 1, 0.001, 0.25)
    assert g.sum() == 0.10
    obj2 = np.zeros((T, N)); obj2[3:, 0] = 0.2
    r, g = simular(obj2, np.zeros((T, N)), np.zeros((T, N)), np.arange(T) % 24, 24, 0.001, 0.25)
    assert g[3] == 0 and g[24] == 0.2                 # con reajuste diario espera a las 0 h UTC


def _correr(mundo, horas=24 * 365 * 3):
    from lab.buscar import submemoria
    from lab.simular import preparar
    nombres = list(MONEDAS_SERVIDOR)
    panel = panel_sintetico(nombres, horas=horas, mundo=mundo, semilla=11)
    M = memoria(panel)
    R, Fs, hora = preparar(panel)
    specs = [e for e in rejilla() if e['forma'] == 'signo' and e['filtro'] == 'ninguno']
    i_btc = nombres.index('BTC')
    D = []
    for e in specs:
        r, g = simular(objetivo(e, M, i_btc), R, Fs, hora, e['cada'], 0.0007, 0.25)
        D.append(diario(r, panel['t'])[0])
    D = np.stack(D, axis=1)[60:-1]
    return specs, D


def test_ruido_no_aprueba_y_ventaja_plantada_si():
    specs, D = _correr('ruido')
    sr, dsr, sr0 = deflactado(D)
    assert (dsr >= 0.95).sum() <= 1, 'en un mercado sin ventaja no debe aprobar casi nada'
    pbo, _, _ = pbo_cscv(D)
    assert pbo > 0.2, pbo
    specs, D = _correr('impulso')
    sr, dsr, sr0 = deflactado(D)
    mejor = specs[int(np.argmax(sr))]
    assert dsr.max() > 0.99
    assert mejor['senal'] in ('cruce', 'impulso'), mejor
    pbo, _, _ = pbo_cscv(D)
    assert pbo < 0.1, pbo


def test_resumen():
    s = resumen_serie(np.array([0.1, -0.5, 0.2]))
    assert abs(s['caida_max_pct'] - 50.0) < 1e-9


if __name__ == '__main__':
    for nombre, f in list(globals().items()):
        if nombre.startswith('test_'):
            f()
            print('OK   ', nombre)
