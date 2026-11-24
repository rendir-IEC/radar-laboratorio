"""Simulación hora a hora con las mismas reglas que el servidor: banda sin operar, reajuste cada N horas,
comisión + deslizamiento sobre el giro y funding pagado por la posición que se tenía."""
import numpy as np
from numba import njit

from .comun import BANDA


@njit(cache=True)
def simular(objetivo, R, Fsig, hora_utc, cada, coste, banda):
    """objetivo[t, j]: posición deseada decidida al final de la hora t (con lo que se sabe en t).
    R[t, j]: rendimiento de t a t+1 (0 si falta algún precio). Fsig[t, j]: funding que se paga en t+1.
    Devuelve el rendimiento neto de cada hora (de t a t+1) y el giro de cada hora."""
    T, N = objetivo.shape
    pos = np.zeros(N)
    r = np.zeros(T)
    giro = np.zeros(T)
    for t in range(T):
        if cada == 1 or hora_utc[t] % cada == 0:
            g = 0.0
            for j in range(N):
                nuevo = objetivo[t, j]
                o = pos[j]
                if o != 0.0 and nuevo != 0.0 and (o > 0.0) == (nuevo > 0.0) and abs(nuevo - o) < banda * abs(o):
                    nuevo = o
                g += abs(nuevo - o)
                pos[j] = nuevo
            giro[t] = g
            r[t] -= g * coste
        acc = 0.0
        for j in range(N):
            if pos[j] != 0.0:
                acc += pos[j] * (R[t, j] - Fsig[t, j])
        r[t] += acc
    return r, giro


def preparar(panel):
    """Rendimientos y funding alineados con la convención de simular()."""
    P = panel['P']
    T, N = P.shape
    R = np.zeros((T, N))
    with np.errstate(invalid='ignore', divide='ignore'):
        R[:-1] = P[1:] / P[:-1] - 1.0
    R = np.where(np.isfinite(R), R, 0.0)
    Fsig = np.zeros((T, N))
    Fsig[:-1] = panel['Fpago'][1:]
    hora = ((panel['t'] // 3_600_000) % 24).astype(np.int64)
    return R, Fsig, hora


def diario(r, t):
    """Suma por día UTC del rendimiento horario (la hora que acaba en t+1 se asigna al día de t+1)."""
    dia = ((t + 3_600_000) // 86_400_000).astype(np.int64)
    d0 = dia[0]
    k = dia - d0
    out = np.zeros(k[-1] + 1)
    np.add.at(out, k, r)
    return out, d0


def correr(e, M, R, Fsig, hora, i_btc, coste, banda=BANDA):
    from .senales import objetivo
    obj = objetivo(e, M, i_btc)
    r, g = simular(obj, R, Fsig, hora, int(e['cada']), coste, banda)
    return r, g, obj
