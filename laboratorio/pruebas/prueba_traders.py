"""Prueba sin red del estudio de traders: con habilidad persistente la puntuación predice y elige a los buenos;
sin habilidad, no se activa la habilidad previa. También: lectura de la lista de vaults y filtros de la selección."""
import datetime as dt
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lab import traders  # noqa: E402

DIA = 86_400_000
T0 = int(dt.datetime(2024, 11, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)


def historias(persistente, n=300, dias=720, cada=10, semilla=5):
    """Cuentas con un punto de historial cada `cada` días, como el historial completo de Hyperliquid."""
    rng = np.random.default_rng(semilla)
    out, hab = {}, {}
    for i in range(n):
        h = rng.normal(0, 0.6) if persistente else 0.0  # rentabilidad anual de su habilidad
        valor, pnl = 100_000.0, 0.0
        av, ph = [], []
        for d in range(0, dias, cada):
            r = h * cada / 365 + rng.normal(0, 0.06)
            g = valor * r
            pnl += g
            valor = max(valor + g, 1.0)
            av.append((T0 + d * DIA, valor))
            ph.append((T0 + d * DIA, pnl))
        d = '0x%040x' % i
        out[d] = {'valor': av, 'pnl': ph}
        hab[d] = h
    return out, hab


def main():
    # 1) búsqueda binaria igual que la lineal
    serie = [(10, 1.0), (20, 2.0), (30, 3.0)]
    assert traders.en(serie, 5) is None and traders.en(serie, 10) == 1.0 and traders.en(serie, 25) == 2.0 and traders.en(serie, 99) == 3.0

    # 2) con habilidad persistente: la puntuación predice, se activa la previa y elige a los buenos
    hs, hab = historias(True)
    v = traders.validar(hs)
    s = v['resumen']
    assert s['meses_estudiados'] >= 12, s
    assert s['ic_puntuacion_media'] > 0.1 and s['t_ic_puntuacion'] > 3, s
    assert s['ventaja_elegidas_pct_mes'] > 0 and s['usar_previa'], s
    ahora = max(t for h in hs.values() for t, _ in h['pnl'])
    info = {d: {'vlm_total': 1e6, 'tipo': 'cuenta'} for d in hs}
    sel, cands = traders.seleccionar(hs, info, ahora)
    assert len(sel) == traders.N_SELECCION and cands >= len(sel)
    media_sel = np.mean([hab[c['direccion']] for c in sel])
    assert media_sel > np.mean(list(hab.values())) + 0.3, media_sel
    assert all(c['t'] > 0 for c in sel) and sel == sorted(sel, key=lambda c: -c['t'])

    # 3) sin habilidad: no se activa la previa
    hs0, _ = historias(False, semilla=9)
    s0 = traders.validar(hs0)['resumen']
    assert not s0['usar_previa'] or s0['t_ic_puntuacion'] < 2.5, s0

    # 4) filtros: creadores de mercado, cuentas paradas, pequeñas y vaults cerrados fuera
    d_mm, d_quieta, d_peq, d_cerr = list(hs)[:4]
    info2 = dict(info)
    info2[d_mm] = {'vlm_total': 1e15, 'tipo': 'cuenta'}
    info2[d_cerr] = {'vlm_total': 0, 'tipo': 'vault', 'cerrado': True}
    hs2 = {d: {'valor': list(h['valor']), 'pnl': list(h['pnl'])} for d, h in hs.items()}
    p_fin = hs2[d_quieta]['pnl'][-5][1]
    hs2[d_quieta]['pnl'] = hs2[d_quieta]['pnl'][:-4] + [(t, p_fin) for t, _ in hs2[d_quieta]['pnl'][-4:]]
    hs2[d_peq]['valor'][-1] = (hs2[d_peq]['valor'][-1][0], 1_000.0)
    sel2, _ = traders.seleccionar(hs2, info2, ahora, n=10_000)
    elegidas = {c['direccion'] for c in sel2}
    assert not elegidas & {d_mm, d_quieta, d_peq, d_cerr}, elegidas & {d_mm, d_quieta, d_peq, d_cerr}

    # 5) una cuenta casi parada no saca una puntuación enorme
    quieta = {'valor': [(T0 + d * DIA, 100_000.0) for d in range(0, 400, 10)], 'pnl': [(T0 + d * DIA, d * 0.01) for d in range(0, 400, 10)]}
    p = traders.puntuar(quieta, T0 + 390 * DIA, 10_000.0)
    assert p is None or p['t'] < 1, p

    # 6) lista de vaults: los dos formatos, sin el HLP, con los cerrados marcados
    crudo = [{'summary': {'vaultAddress': '0x' + 'a' * 40, 'name': 'Bueno', 'tvl': '250000.5', 'leader': '0x' + 'b' * 40, 'isClosed': False}},
             {'summary': {'vaultAddress': '0x' + 'c' * 40, 'name': 'Hyperliquidity Provider (HLP)', 'tvl': '1e9'}},
             {'vaultAddress': '0x' + 'd' * 40, 'name': 'Cerrado', 'tvl': 0, 'isClosed': True},
             {'summary': {'vaultAddress': 'malo', 'name': 'x'}}]
    viejo = traders._http
    traders._http = lambda url, **k: (200, json.dumps(crudo).encode())
    try:
        vs, estado = traders.vaults()
    finally:
        traders._http = viejo
    assert estado == 200 and [v['nombre'] for v in vs] == ['Bueno', 'Cerrado'], vs
    assert vs[0]['tvl'] == 250000.5 and not vs[0]['cerrado'] and vs[1]['cerrado']

    # 7) informe sin errores
    res = {'generado': 'x', 'grupo_cuentas': 300, 'grupo_vaults': 2, 'estado_vaults': 200, 'historiales': 300, 'validacion': v, 'carteras': sel, 'candidatas': cands}
    texto = traders.informe(res)
    assert 'predice' in texto and sel[0]['direccion'][:6] in texto
    print('prueba_traders: OK', json.dumps(s))


if __name__ == '__main__':
    main()
