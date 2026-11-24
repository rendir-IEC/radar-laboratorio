# Laboratorio: resultados del 2026-11-24

> Investigación en papel. Resultados pasados, con costes estimados; no garantizan nada en el futuro.

- Periodo: 2021-01-31 → 2026-11-23 (2123 días).
- Estrategias probadas: **2232** en 4 máquinas. Coste por cada 100 % de giro: 0.070 %.
- Sharpe anual que daría la pura suerte con tantas pruebas: **1.44**.
- Pasan la prueba contra la suerte (Sharpe deflactado ≥ 0,95, positivas en las dos mitades y en el universo amplio): **0**.
- Probabilidad de sobreajuste (CSCV): **13 %** (cuanto más baja, mejor; 50 % equivale a elegir al azar).

## ¿Funciona elegir a las mejores? (fuera de muestra)

Cada 91 días se eligen las 5 mejores con la historia de ese momento y se mantienen el trimestre siguiente.

| | Rent. anual | Sharpe | Caída máx. | Semanas en positivo |
|---|---|---|---|---|
| Las 5 mejores de cada momento | -0.1 % | 0.02 | 19.7 % | 29 % |
| La mejor de cada momento | -2.1 % | -0.16 | 27.5 % | 23 % |
| Media de todas | -2.9 % | -1.07 | 15.2 % | 33 % |
| Comprar y mantener BTC | 10.5 % | 0.45 | 67.0 % | 51 % |

## Las mejores (diversas entre sí)

| Estrategia | Aprobada | Sharpe | Deflactado | Rent. anual | Caída máx. | 1ª mitad | 2ª mitad | Último año | Amplio |
|---|---|---|---|---|---|---|---|---|---|
| Tendencia 1 día / 2 semanas (relativa entre monedas, graduada) | no | 1.38 | 0.44 | 1.8 % | 1.6 % | 0.52 | 2.15 | 2.07 | -0.38 |
| Tendencia 1 día / 1 semana (solo compras, si BTC sube, graduada, reajuste diario) | no | 1.33 | 0.38 | 4.9 % | 4.1 % | 1.73 | 0.98 | 0.72 | 1.21 |
| Tendencia 12 h / 2 semanas (si BTC sube) | no | 1.27 | 0.34 | 27.0 % | 19.9 % | 1.34 | 1.22 | 0.81 | 1.22 |
| Impulso de 3 días (solo compras, si BTC sube, graduada, reajuste diario) | no | 1.18 | 0.24 | 5.5 % | 7.6 % | 1.02 | 1.33 | 1.10 | 1.06 |
| Impulso de 1 mes (solo compras, graduada, reajuste diario) | no | 1.12 | 0.22 | 17.1 % | 21.2 % | 1.29 | 0.93 | 0.72 | 0.94 |
| Tendencia 1 día / 2 semanas (si BTC sube, graduada, reajuste diario) | no | 1.12 | 0.22 | 5.1 % | 4.0 % | 1.50 | 0.77 | 0.29 | 1.04 |
| Tendencia 1 día / 1 mes (si BTC sube) | no | 1.10 | 0.20 | 21.7 % | 22.4 % | 1.28 | 0.92 | 0.40 | 1.06 |
| Tendencia 1 día / 1 mes (relativa entre monedas, graduada, reajuste diario) | no | 1.10 | 0.20 | 6.4 % | 8.2 % | 0.28 | 1.80 | 1.22 | 0.17 |
| Tendencia 12 h / 2 semanas | no | 1.09 | 0.20 | 33.4 % | 29.5 % | 1.33 | 0.85 | 0.56 | 0.99 |
| Tendencia 1 día / 3 días (solo compras, si BTC sube) | no | 1.05 | 0.16 | 19.0 % | 21.0 % | 1.21 | 0.92 | 0.67 | 0.96 |
| Tendencia 12 h / 1 semana (solo compras, graduada) | no | 1.05 | 0.16 | 4.9 % | 6.2 % | 0.97 | 1.12 | 0.54 | 0.90 |
| Contra el funding (1 semana) (si BTC baja) | no | 1.04 | 0.15 | 18.8 % | 21.8 % | 1.47 | 0.55 | 1.58 | 1.07 |

Para el servidor: lab_cruce_24_336_c2_sec_amb_nf_h1, lab_cruce_24_168_c2_ser_lar_ba_h24, lab_cruce_12_336_s_ser_amb_ba_h1 (candidatas en prueba (ninguna pasa la prueba contra la suerte)).

