"""Paso 2: evalúa un fragmento de la rejilla de estrategias (cada máquina de la matriz hace el suyo).
Uso: python -m lab.buscar --panel datos/panel.npz --fragmento 0 --de 4 --salida trozos/trozo_0.npz"""
import argparse
import json
import os
import time

import numpy as np

from .comun import COMISION, DESLIZAMIENTO, MONEDAS_SERVIDOR
from .datos import cargar_panel
from .senales import memoria, rejilla
from .simular import correr, diario, preparar


def subpanel(panel, cols):
    out = dict(panel)
    for k in ('P', 'V', 'TB', 'Fpago', 'Finfo'):
        out[k] = panel[k][:, cols]
    out['monedas'] = [panel['monedas'][c] for c in cols]
    return out


def submemoria(M, cols):
    return {'lp': M['lp'][:, cols], 'ema': {s: v[:, cols] for s, v in M['ema'].items()}, 'sig': M['sig'][:, cols],
            'fe24': M['fe24'][:, cols], 'fe168': M['fe168'][:, cols], 'lista': M['lista'][:, cols]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--panel', default='datos/panel.npz')
    ap.add_argument('--fragmento', type=int, default=0)
    ap.add_argument('--de', type=int, default=1)
    ap.add_argument('--salida', default='trozos/trozo_0.npz')
    ap.add_argument('--limite', type=int, default=0, help='solo para pruebas: evalúa como mucho este número')
    a = ap.parse_args()
    t0 = time.time()
    panel = cargar_panel(a.panel)
    M = memoria(panel)
    R, Fsig, hora = preparar(panel)
    coste = COMISION + DESLIZAMIENTO
    monedas = panel['monedas']
    universos = {
        'servidor': [monedas.index(m) for m in MONEDAS_SERVIDOR if m in monedas],
        'amplio': list(range(len(monedas))),
    }
    if 'BTC' not in monedas:
        raise SystemExit('Falta BTC en el panel')
    todas = rejilla()
    mias = [e for i, e in enumerate(todas) if i % a.de == a.fragmento]
    if a.limite:
        mias = mias[: a.limite]
    salida = {}
    for nombre_u, cols in universos.items():
        Mu = submemoria(M, cols)
        Ru, Fu = R[:, cols], Fsig[:, cols]
        i_btc = [monedas[c] for c in cols].index('BTC')
        dias = None
        filas, giros, expos = [], [], []
        for e in mias:
            r, g, obj = correr(e, Mu, Ru, Fu, hora, i_btc, coste)
            d, d0 = diario(r, panel['t'])
            filas.append(d.astype(np.float32))
            giros.append(float(g.sum()))
            expos.append(float(np.abs(obj).sum(axis=1).mean()))
            dias = d0
        salida[nombre_u] = (np.stack(filas, axis=1) if filas else np.zeros((0, 0), np.float32), np.array(giros), np.array(expos), dias)
        # monedas en lista por día (para saber desde cuándo hay suficientes) y referencia: comprar y mantener BTC
        n_lista = Mu['lista'].sum(axis=1).astype(np.float64)
        nl, _ = diario(n_lista / 24.0, panel['t'])
        salida[nombre_u + '_nlista'] = nl
    rb = np.zeros(len(panel['t']))
    jb = monedas.index('BTC')
    rb[:] = R[:, jb]
    btc, _ = diario(rb, panel['t'])
    os.makedirs(os.path.dirname(a.salida) or '.', exist_ok=True)
    np.savez_compressed(
        a.salida,
        ids=np.array([e['id'] for e in mias]),
        specs=json.dumps(mias),
        D_servidor=salida['servidor'][0], giro_servidor=salida['servidor'][1], expo_servidor=salida['servidor'][2],
        D_amplio=salida['amplio'][0], giro_amplio=salida['amplio'][1], expo_amplio=salida['amplio'][2],
        nlista_servidor=salida['servidor_nlista'], nlista_amplio=salida['amplio_nlista'],
        dia0=np.int64(salida['servidor'][3]), btc=btc, total_rejilla=np.int64(len(todas)),
        horas=np.int64(len(panel['t'])), monedas=np.array(monedas), coste=np.float64(coste),
        fuente=json.dumps(panel['fuente']), registro=json.dumps(panel.get('registro', {})),
    )
    print(json.dumps({'fragmento': a.fragmento, 'de': a.de, 'estrategias': len(mias), 'segundos': round(time.time() - t0, 1)}))


if __name__ == '__main__':
    main()
