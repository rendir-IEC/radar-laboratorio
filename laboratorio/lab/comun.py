"""Constantes compartidas con el servidor (servidor/worker.js, objeto AP). Si cambian allí, cambian aquí."""
import math

H = 3_600_000
SPANS = (12, 24, 72, 168, 336, 720)          # AP.SPANS: medias exponenciales del log-precio, en horas
SPAN_VOL = 168                                # varianza horaria: EMA con alfa 2/169 (apPaso)
VOL_OBJ_H = 0.5 / math.sqrt(8760)             # AP.VOL_OBJ_H: 50 % anual repartido entre las monedas
HORAS_MIN = 720                               # AP.HORAS_MIN: una moneda entra con 720 h de memoria
BANDA = 0.25                                  # AP.BANDA: banda sin operar
COMISION = 0.00045                            # AP.COMISION: taker de Hyperliquid
DESLIZAMIENTO = 0.00025                       # solo en el laboratorio: diferencial y deslizamiento (prudente)
MONEDAS_SERVIDOR = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE', 'LINK', 'AVAX', 'SUI',
                    'ZEC', 'NEAR', 'UNI', 'ENA', 'AAVE', 'ADA', 'ARB', 'WLD', 'XMR', 'kPEPE']
