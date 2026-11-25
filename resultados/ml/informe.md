# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.1); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 6.6). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 14.7 % al año, Sharpe 0.54, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -41.6 % | -1.43 | -0.61 | 88.7 % | 1.07 | -19 % | -59 % | -28 % | -44 % |
| solo compras k3 | -6.8 % | 0.22 | 0.63 | 71.0 % | 1.06 | +7 % | +56 % | -15 % | -46 % |
| largo corto k5 | -33.0 % | -1.53 | -0.60 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -32 % |
| solo compras k5 | -6.8 % | 0.20 | 0.56 | 71.3 % | 0.87 | +32 % | +50 % | -32 % | -43 % |
| lenta largo corto k5 | -20.1 % | -0.85 | -0.73 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -34 % |
| lenta solo compras k5 | 2.2 % | 0.34 | 0.38 | 67.0 % | 0.10 | +19 % | +120 % | -34 % | -38 % |
| lenta largo corto k5 un dia tarde | -21.1 % | -0.91 | -0.79 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -33 % |
| lenta solo compras k5 un dia tarde | 3.6 % | 0.36 | 0.40 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -40 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.073** (t = 12.3); positivo el 63 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.051 (t = 8.8). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -3.6 % al año, Sharpe 0.30, caída máxima 73.6 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 16.3 % | 0.58 | 1.34 | 48.8 % | 1.23 | -14 % | +74 % | +14 % | +4 % |
| solo compras k3 | 21.0 % | 0.62 | 1.09 | 49.2 % | 1.21 | -12 % | +121 % | +8 % | -2 % |
| largo corto k5 | 17.7 % | 0.69 | 1.61 | 29.3 % | 1.11 | -10 % | +42 % | +25 % | +16 % |
| solo compras k5 | 15.8 % | 0.55 | 0.98 | 51.3 % | 1.08 | +11 % | +113 % | -15 % | -14 % |
| lenta largo corto k5 | 12.0 % | 0.51 | 0.86 | 44.1 % | 0.43 | -10 % | +37 % | -3 % | +28 % |
| lenta solo compras k5 | 36.4 % | 0.81 | 0.99 | 45.3 % | 0.42 | +48 % | +142 % | +6 % | -16 % |
| lenta largo corto k5 un dia tarde | -4.6 % | -0.01 | 0.36 | 53.6 % | 0.43 | -13 % | -11 % | -7 % | +16 % |
| lenta solo compras k5 un dia tarde | 8.1 % | 0.43 | 0.61 | 61.6 % | 0.42 | +58 % | +68 % | -32 % | -27 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
