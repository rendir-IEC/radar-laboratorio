"""Paso 1 del laboratorio: descarga (o genera) los datos y guarda el panel.
Uso: python -m lab.preparar --salida datos/panel.npz [--universo 60] [--sintetico ruido|impulso]"""
import argparse
import json
import os
import time

from .comun import MONEDAS_SERVIDOR
from .datos import construir_panel, guardar_panel, universo
from .sintetico import panel_sintetico


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--salida', default='datos/panel.npz')
    ap.add_argument('--universo', type=int, default=60)
    ap.add_argument('--sintetico', default='')
    ap.add_argument('--horas', type=int, default=24 * 365 * 4)
    a = ap.parse_args()
    os.makedirs(os.path.dirname(a.salida) or '.', exist_ok=True)
    t0 = time.time()
    if a.sintetico:
        nombres = list(MONEDAS_SERVIDOR) + ['SINT%02d' % i for i in range(max(0, a.universo - len(MONEDAS_SERVIDOR)))]
        panel = panel_sintetico(nombres, horas=a.horas, mundo=a.sintetico)
    else:
        nombres = universo(a.universo)
        panel = construir_panel(nombres)
    guardar_panel(panel, a.salida)
    P = panel['P']
    cobertura = {m: int((P[:, j] > 0).sum()) for j, m in enumerate(panel['monedas'])}
    print(json.dumps({'monedas': len(nombres), 'horas': int(P.shape[0]), 'horas_con_precio': cobertura,
                      'fuentes': panel['fuente'], 'registro': panel.get('registro', {}), 'segundos': round(time.time() - t0, 1)}, ensure_ascii=False)[:4000])


if __name__ == '__main__':
    main()
