# Laboratorio: resultados del 2026-11-28

> Investigación en papel. Resultados pasados, con costes estimados; no garantizan nada en el futuro.

- Periodo: 2021-01-31 → 2026-11-27 (2127 días).
- Estrategias probadas: **2304** en 4 máquinas. Coste por cada 100 % de giro: 0.070 %.
- Sharpe anual que daría la pura suerte con tantas pruebas: **1.44**.
- Pasan la prueba contra la suerte (Sharpe deflactado ≥ 0,95, positivas en las dos mitades y en el universo amplio): **0**.
- Probabilidad de sobreajuste (CSCV): **14 %** (cuanto más baja, mejor; 50 % equivale a elegir al azar). Mide si la mejor dentro de muestra queda por encima de la mediana fuera de muestra; no dice si gana dinero: eso lo dice la tabla siguiente.

## ¿Funciona elegir a las mejores? (fuera de muestra)

Cada 91 días se eligen las 5 mejores con la historia de ese momento y se mantienen el trimestre siguiente.

| | Rent. anual | Sharpe | Caída máx. | Semanas en positivo |
|---|---|---|---|---|
| Las 5 mejores de cada momento | -0.6 % | -0.06 | 21.5 % | 41 % |
| La mejor de cada momento | -3.2 % | -0.27 | 28.3 % | 38 % |
| Media de todas | -2.7 % | -0.92 | 14.4 % | 34 % |
| Comprar y mantener BTC | 10.0 % | 0.44 | 67.0 % | 51 % |

## Las mejores (diversas entre sí)

| Estrategia | Aprobada | Sharpe | Deflactado | Rent. anual | Caída máx. | 1ª mitad | 2ª mitad | Último año | Amplio |
|---|---|---|---|---|---|---|---|---|---|
| Tendencia 1 día / 2 semanas (relativa entre monedas, graduada) | no | 1.37 | 0.43 | 1.8 % | 1.6 % | 0.54 | 2.12 | 2.09 | -0.39 |
| Tendencia 1 día / 1 semana (solo compras, si BTC sube, graduada, reajuste diario) | no | 1.32 | 0.38 | 4.9 % | 4.2 % | 1.70 | 1.00 | 0.72 | 1.15 |
| Tendencia 12 h / 2 semanas (si BTC sube) | no | 1.27 | 0.34 | 27.0 % | 19.9 % | 1.31 | 1.24 | 0.81 | 1.23 |
| Impulso de 3 días (solo compras, si BTC sube, graduada, reajuste diario) | no | 1.18 | 0.24 | 5.5 % | 7.6 % | 1.00 | 1.34 | 1.10 | 1.05 |
| Tendencia 1 día / 2 semanas (si BTC sube, graduada, reajuste diario) | no | 1.12 | 0.21 | 5.1 % | 4.0 % | 1.48 | 0.79 | 0.29 | 1.00 |
| Impulso de 1 mes (solo compras, graduada, reajuste diario) | no | 1.11 | 0.21 | 17.0 % | 21.4 % | 1.25 | 0.96 | 0.72 | 0.93 |
| Tendencia 1 día / 1 mes (si BTC sube) | no | 1.09 | 0.20 | 21.6 % | 22.4 % | 1.23 | 0.96 | 0.40 | 1.05 |
| Tendencia 12 h / 2 semanas | no | 1.09 | 0.19 | 33.1 % | 29.5 % | 1.31 | 0.85 | 0.64 | 0.98 |
| Tendencia 1 día / 1 mes (relativa entre monedas, graduada, reajuste diario) | no | 1.08 | 0.19 | 6.3 % | 8.2 % | 0.28 | 1.77 | 1.33 | 0.12 |
| Tendencia 1 día / 3 días (solo compras, si BTC sube) | no | 1.04 | 0.16 | 18.9 % | 21.2 % | 1.18 | 0.94 | 0.67 | 0.94 |
| Contra el funding (1 semana) (si BTC baja) | no | 1.04 | 0.15 | 18.9 % | 21.8 % | 1.46 | 0.57 | 1.75 | 1.06 |
| Tendencia 12 h / 1 semana (solo compras, graduada) | no | 1.04 | 0.15 | 4.8 % | 6.2 % | 0.95 | 1.13 | 0.51 | 0.86 |

Para el servidor: lab_cruce_24_336_c2_sec_amb_nf_h1, lab_cruce_24_168_c2_ser_lar_ba_h24, lab_cruce_12_336_s_ser_amb_ba_h1 (candidatas en prueba (ninguna pasa la prueba contra la suerte)).


## Comprobaciones

BTC en fechas conocidas: 2021-11-10 67010.0, 2022-06-18 20457.3, 2022-11-21 16272.6, 2024-03-14 73127.6, 2025-01-20 101311.5.

| Simulación (20 monedas) | Rent. anual con costes | Sin costes | Sharpe con costes | Sin costes | Giro anual |
|---|---|---|---|---|---|
| siempre_comprado_20_monedas_escala_vol | 4.4 % | 4.9 % | 0.31 | 0.32 | 6 |
| tendencia_semana_mes | 25.6 % | 27.7 % | 0.90 | 0.96 | 23 |
| vendido_cuando_funding_positivo | -10.1 % | -9.2 % | -0.14 | -0.12 | 14 |
| lab_cruce_24_336_c2_sec_amb_nf_h1 | 1.8 % | 2.4 % | 1.37 | 1.81 | 8 |
| lab_cruce_24_168_c2_ser_lar_ba_h24 | 4.9 % | 5.3 % | 1.32 | 1.43 | 6 |
| lab_cruce_12_336_s_ser_amb_ba_h1 | 27.0 % | 32.7 % | 1.27 | 1.49 | 62 |
| lab_impulso_72_c2_ser_lar_ba_h24 | 5.5 % | 6.4 % | 1.18 | 1.36 | 12 |
| lab_cruce_24_336_c2_ser_amb_ba_h24 | 5.1 % | 5.6 % | 1.12 | 1.24 | 7 |
| lab_impulso_720_c0.5_ser_lar_nf_h24 | 17.0 % | 18.6 % | 1.11 | 1.20 | 18 |

**El sistema del servidor desde 2021-01-31 (tal como está: expertos de precio y funding, sin carteras ni flujo, ETA 10)**: 1.4 % al año, Sharpe 0.18, caída máxima 39.7 %, semanas en positivo 35 %. Por año: 2021 +0.3 %, 2022 -9.4 %, 2023 +16.7 %, 2024 +29.0 %, 2025 -20.1 %, 2026 -0.6 %.

**El sistema del servidor desde 2021-01-31 (igual pero con ETA 1)**: -0.4 % al año, Sharpe 0.03, caída máxima 27.7 %, semanas en positivo 39 %. Por año: 2021 +14.1 %, 2022 -10.9 %, 2023 +1.3 %, 2024 +12.4 %, 2025 -9.1 %, 2026 -7.0 %.

**El sistema del servidor desde 2021-01-31 (igual pero con pesos fijos e iguales)**: -5.8 % al año, Sharpe -0.49, caída máxima 45.5 %, semanas en positivo 37 %. Por año: 2021 +13.2 %, 2022 -16.1 %, 2023 -6.3 %, 2024 +4.3 %, 2025 -12.8 %, 2026 -12.9 %.

**El sistema del servidor desde 2021-01-31 (igual pero comparando a los expertos por unidad de riesgo (cada uno escalado a un 20 % de volatilidad, sin apalancar))**: 5.9 % al año, Sharpe 0.57, caída máxima 16.7 %, semanas en positivo 43 %. Por año: 2021 +15.7 %, 2022 +2.0 %, 2023 +5.9 %, 2024 +12.8 %, 2025 -1.0 %, 2026 +0.0 %.

**El sistema del servidor desde 2021-01-31 (ETA 10 y con las candidatas del laboratorio, elegidas con estos mismos datos: dentro de muestra, no prueba que mejoren el sistema)**: 2.1 % al año, Sharpe 0.21, caída máxima 36.5 %, semanas en positivo 35 %. Por año: 2021 +0.9 %, 2022 -8.2 %, 2023 +15.1 %, 2024 +28.6 %, 2025 -17.3 %, 2026 -0.4 %.

Monedas con algún movimiento horario de más del 40 % (revisar empalmes): DOGE (+52 % el 2021-01-29 04:00 UTC), ZEC (+46 % el 2021-05-19 13:00 UTC), UNI (+44 % el 2024-02-23 15:00 UTC), TRUMP (+42 % el 2025-01-19 22:00 UTC), CRV (+42 % el 2021-05-19 13:00 UTC), DOT (+41 % el 2021-05-19 13:00 UTC), XLM (+67 % el 2021-05-19 13:00 UTC).

