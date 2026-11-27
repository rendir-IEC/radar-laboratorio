# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1366 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 6.5). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 14.9 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -42.0 % | -1.45 | -0.63 | 88.7 % | 1.07 | -19 % | -59 % | -28 % | -45 % |
| solo compras k3 | -7.7 % | 0.21 | 0.62 | 71.6 % | 1.06 | +7 % | +56 % | -15 % | -48 % |
| largo corto k5 | -33.4 % | -1.56 | -0.63 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -34 % |
| solo compras k5 | -7.4 % | 0.19 | 0.55 | 71.6 % | 0.87 | +32 % | +50 % | -32 % | -44 % |
| lenta largo corto k5 | -21.1 % | -0.90 | -0.78 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -37 % |
| lenta solo compras k5 | 0.4 % | 0.31 | 0.35 | 67.9 % | 0.10 | +19 % | +120 % | -34 % | -42 % |
| lenta largo corto k5 un dia tarde | -21.8 % | -0.94 | -0.83 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -35 % |
| lenta solo compras k5 un dia tarde | 2.2 % | 0.34 | 0.38 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -43 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1366 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.067** (t = 11.3); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.048 (t = 8.3). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -0.6 % al año, Sharpe 0.34, caída máxima 74.9 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 1.8 % | 0.24 | 1.07 | 52.3 % | 1.22 | -16 % | -5 % | +40 % | -4 % |
| solo compras k3 | 26.6 % | 0.68 | 1.14 | 60.4 % | 1.18 | +32 % | +119 % | +40 % | -40 % |
| largo corto k5 | 4.4 % | 0.29 | 1.24 | 38.6 % | 1.10 | -8 % | -2 % | +30 % | +1 % |
| solo compras k5 | 39.6 % | 0.84 | 1.27 | 52.1 % | 1.07 | +49 % | +146 % | +37 % | -31 % |
| lenta largo corto k5 | 5.4 % | 0.33 | 0.67 | 36.4 % | 0.40 | +2 % | -5 % | +8 % | +17 % |
| lenta solo compras k5 | 18.9 % | 0.59 | 0.75 | 56.4 % | 0.38 | +44 % | +94 % | -16 % | -18 % |
| lenta largo corto k5 un dia tarde | -3.3 % | 0.04 | 0.38 | 48.4 % | 0.40 | -3 % | -34 % | +5 % | +30 % |
| lenta solo compras k5 un dia tarde | 12.6 % | 0.50 | 0.66 | 52.8 % | 0.38 | +45 % | +51 % | -20 % | -11 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
