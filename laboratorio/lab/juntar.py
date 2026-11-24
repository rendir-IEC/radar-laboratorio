"""Paso 3: junta los fragmentos, pasa las pruebas contra la suerte y escribe los resultados.
Uso: python -m lab.juntar --trozos trozos --salida ../resultados"""
import argparse
import datetime as dt
import glob
import json
import math
import os

import numpy as np

from .estadistica import DIAS_ANO, deflactado, diversas, paso_a_paso, pbo_cscv, resumen_serie, sharpe, umbral_empirico
from .senales import nombre

MIN_MONEDAS = 5          # el periodo de estudio empieza cuando el servidor tendría al menos 5 monedas en lista
UMBRAL_DSR = 0.95


def cargar(carpeta):
    archivos = sorted(glob.glob(os.path.join(carpeta, '**', 'trozo_*.npz'), recursive=True))
    if not archivos:
        raise SystemExit('No hay fragmentos en ' + carpeta)
    partes = [np.load(f, allow_pickle=False) for f in archivos]
    base = partes[0]
    out = {
        'specs': sum((json.loads(str(p['specs'])) for p in partes), []),
        'D_servidor': np.concatenate([p['D_servidor'] for p in partes], axis=1).astype(np.float64),
        'D_amplio': np.concatenate([p['D_amplio'] for p in partes], axis=1).astype(np.float64),
        'giro_servidor': np.concatenate([p['giro_servidor'] for p in partes]),
        'expo_servidor': np.concatenate([p['expo_servidor'] for p in partes]),
        'nlista': base['nlista_servidor'], 'btc': base['btc'], 'dia0': int(base['dia0']),
        'total_rejilla': int(base['total_rejilla']), 'monedas': [str(m) for m in base['monedas']],
        'coste': float(base['coste']), 'fuente': json.loads(str(base['fuente'])), 'registro': json.loads(str(base['registro'])),
        'fragmentos': len(archivos),
    }
    for p in partes[1:]:
        assert int(p['dia0']) == out['dia0'], 'los fragmentos no usan el mismo panel'
    return out


def fecha(dia):
    return (dt.date(1970, 1, 1) + dt.timedelta(days=int(dia))).isoformat()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trozos', default='trozos')
    ap.add_argument('--salida', default='../resultados')
    a = ap.parse_args()
    X = cargar(a.trozos)
    specs = X['specs']
    M = len(specs)
    # periodo: desde que hay MIN_MONEDAS en lista hasta el último día completo
    nl = X['nlista']
    ini = int(np.argmax(nl >= MIN_MONEDAS))
    fin = len(nl) - 1
    D = X['D_servidor'][ini:fin]
    Da = X['D_amplio'][ini:fin]
    btc = X['btc'][ini:fin]
    T = D.shape[0]
    anos = T / DIAS_ANO
    sr, dsr, sr0 = deflactado(D, n_pruebas=M)
    sr_a = sharpe(Da)
    mitad = T // 2
    sr_h1, sr_h2 = sharpe(D[:mitad]), sharpe(D[mitad:])
    sr_ult = sharpe(D[-365:]) if T > 400 else sr
    pbo, S, ncombos = pbo_cscv(D)
    raiz = math.sqrt(DIAS_ANO)
    aprobada = (dsr >= UMBRAL_DSR) & (sr_a > 0) & (sr_h1 > 0) & (sr_h2 > 0)
    orden = np.lexsort((-sr, -dsr))
    elegidas = diversas(orden, D, max_corr=0.85, n=12)
    # selección hacia delante: el procedimiento entero, fuera de muestra
    activa = D != 0
    pf5, usado5, elec5 = paso_a_paso(D, k=5, activa=activa)
    pf1, usado1, _ = paso_a_paso(D, k=1, activa=activa)
    btc_oos = btc[usado5]
    todas_oos = D[usado5].mean(axis=1)

    def ficha(i):
        e = specs[i]
        s = resumen_serie(D[:, i])
        return {
            'id': e['id'], 'nombre': nombre(e),
            'spec': {k: e[k] for k in ('senal', 'a', 'b', 'forma', 'k', 'modo', 'lado', 'filtro', 'cada') if k in e},
            'aprobada': bool(aprobada[i]),
            'sharpe_anual': round(float(sr[i] * raiz), 3),
            'sharpe_deflactado': round(float(dsr[i]), 4),
            'rent_anual_pct': round(s.get('rent_anual_pct', 0), 2),
            'vol_anual_pct': round(s.get('vol_anual_pct', 0), 2),
            'caida_max_pct': round(s.get('caida_max_pct', 0), 2),
            'semanas_positivas_pct': round(s.get('semanas_positivas_pct', 0), 1),
            'sharpe_primera_mitad': round(float(sr_h1[i] * raiz), 3),
            'sharpe_segunda_mitad': round(float(sr_h2[i] * raiz), 3),
            'sharpe_ultimo_ano': round(float(sr_ult[i] * raiz), 3),
            'sharpe_universo_amplio': round(float(sr_a[i] * raiz), 3),
            'giro_anual': round(float(X['giro_servidor'][i] / max(anos, 1e-9)), 1),
            'exposicion_media': round(float(X['expo_servidor'][i]), 3),
        }

    res5, res1, resb, rest = resumen_serie(pf5), resumen_serie(pf1), resumen_serie(btc_oos), resumen_serie(todas_oos)
    salida = {
        'generado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'version': 1,
        'aviso': 'Investigación en papel. Resultados pasados, con costes estimados; no garantizan nada en el futuro.',
        'periodo': {'desde': fecha(X['dia0'] + ini), 'hasta': fecha(X['dia0'] + fin - 1), 'dias': T},
        'datos': {'monedas_servidor': 20, 'monedas_amplio': len(X['monedas']), 'fuentes': X['fuente'], 'registro': X['registro']},
        'pruebas': {'estrategias_probadas': M, 'rejilla': X['total_rejilla'], 'maquinas': X['fragmentos'],
                    'coste_por_giro_pct': round(X['coste'] * 100, 4),
                    'sharpe_anual_que_daria_la_suerte': round(float(sr0 * raiz), 3),
                    'sharpe_anual_suerte_variante_empirica': round(float(umbral_empirico(D, M) * raiz), 3),
                    'aprobadas': int(aprobada.sum()),
                    'probabilidad_sobreajuste': round(pbo, 3), 'cscv_bloques': S, 'cscv_particiones': ncombos},
        'procedimiento_fuera_de_muestra': {
            'explicacion': 'Cada 91 días se eligen las 5 mejores con la historia de ese momento y se mantienen el trimestre siguiente.',
            'top5': res5, 'top1': res1, 'comprar_y_mantener_btc': resb, 'media_de_todas': rest,
            'ultimas_elegidas': [specs[i]['id'] for i in (elec5[-1][1] if elec5 else [])],
        },
        'estrategias': [ficha(i) for i in elegidas],
    }
    # el servidor carga como mucho 6: primero las aprobadas; si no hay, las 3 mejores como candidatas en prueba
    aprob = [f for f in salida['estrategias'] if f['aprobada']]
    salida['para_el_servidor'] = [f['id'] for f in (aprob[:6] if aprob else salida['estrategias'][:3])]
    salida['para_el_servidor_estado'] = 'aprobadas' if aprob else 'candidatas en prueba (ninguna pasa la prueba contra la suerte)'
    os.makedirs(a.salida, exist_ok=True)
    with open(os.path.join(a.salida, 'estrategias.json'), 'w') as f:
        json.dump(salida, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.salida, 'informe.md'), 'w') as f:
        f.write(informe(salida))
    hist = os.path.join(a.salida, 'historial.csv')
    nueva = not os.path.exists(hist)
    with open(hist, 'a') as f:
        if nueva:
            f.write('generado,desde,hasta,estrategias,aprobadas,pbo,sharpe_suerte,oos_top5_sharpe,oos_top5_rent,oos_btc_rent,mejor_id,mejor_dsr\n')
        m = salida['estrategias'][0] if salida['estrategias'] else {'id': '', 'sharpe_deflactado': 0}
        f.write('%s,%s,%s,%d,%d,%.3f,%.3f,%.3f,%.2f,%.2f,%s,%.4f\n' % (
            salida['generado'], salida['periodo']['desde'], salida['periodo']['hasta'], M, int(aprobada.sum()), pbo,
            sr0 * raiz, res5.get('sharpe_anual', 0), res5.get('rent_anual_pct', 0), resb.get('rent_anual_pct', 0), m['id'], m['sharpe_deflactado']))
    print(json.dumps({k: salida[k] for k in ('periodo', 'pruebas', 'para_el_servidor', 'para_el_servidor_estado')}, ensure_ascii=False))
    print(json.dumps({'top5': res5, 'btc': resb}, ensure_ascii=False))


def informe(s):
    p, q = s['pruebas'], s['procedimiento_fuera_de_muestra']
    l = []
    l.append('# Laboratorio: resultados del %s\n' % s['generado'][:10])
    l.append('> %s\n' % s['aviso'])
    l.append('- Periodo: %s → %s (%d días).' % (s['periodo']['desde'], s['periodo']['hasta'], s['periodo']['dias']))
    l.append('- Estrategias probadas: **%d** en %d máquinas. Coste por cada 100 %% de giro: %.3f %%.' % (p['estrategias_probadas'], p['maquinas'], p['coste_por_giro_pct']))
    l.append('- Sharpe anual que daría la pura suerte con tantas pruebas: **%.2f**.' % p['sharpe_anual_que_daria_la_suerte'])
    l.append('- Pasan la prueba contra la suerte (Sharpe deflactado ≥ 0,95, positivas en las dos mitades y en el universo amplio): **%d**.' % p['aprobadas'])
    l.append('- Probabilidad de sobreajuste (CSCV): **%.0f %%** (cuanto más baja, mejor; 50 %% equivale a elegir al azar).\n' % (p['probabilidad_sobreajuste'] * 100))
    l.append('## ¿Funciona elegir a las mejores? (fuera de muestra)\n')
    l.append(q['explicacion'] + '\n')
    l.append('| | Rent. anual | Sharpe | Caída máx. | Semanas en positivo |')
    l.append('|---|---|---|---|---|')
    for k, n in (('top5', 'Las 5 mejores de cada momento'), ('top1', 'La mejor de cada momento'), ('media_de_todas', 'Media de todas'), ('comprar_y_mantener_btc', 'Comprar y mantener BTC')):
        r = q[k]
        if 'sharpe_anual' in r:
            l.append('| %s | %.1f %% | %.2f | %.1f %% | %.0f %% |' % (n, r['rent_anual_pct'], r['sharpe_anual'], r['caida_max_pct'], r['semanas_positivas_pct']))
    l.append('\n## Las mejores (diversas entre sí)\n')
    l.append('| Estrategia | Aprobada | Sharpe | Deflactado | Rent. anual | Caída máx. | 1ª mitad | 2ª mitad | Último año | Amplio |')
    l.append('|---|---|---|---|---|---|---|---|---|---|')
    for f in s['estrategias']:
        l.append('| %s | %s | %.2f | %.2f | %.1f %% | %.1f %% | %.2f | %.2f | %.2f | %.2f |' % (
            f['nombre'], 'sí' if f['aprobada'] else 'no', f['sharpe_anual'], f['sharpe_deflactado'], f['rent_anual_pct'], f['caida_max_pct'],
            f['sharpe_primera_mitad'], f['sharpe_segunda_mitad'], f['sharpe_ultimo_ano'], f['sharpe_universo_amplio']))
    l.append('\nPara el servidor: %s (%s).\n' % (', '.join(s['para_el_servidor']) or 'ninguna', s['para_el_servidor_estado']))
    return '\n'.join(l) + '\n'


if __name__ == '__main__':
    main()
