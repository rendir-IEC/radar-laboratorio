# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 6.5). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 15.1 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -41.4 % | -1.42 | -0.61 | 88.8 % | 1.07 | -19 % | -59 % | -28 % | -44 % |
| solo compras k3 | -5.9 % | 0.23 | 0.65 | 71.4 % | 1.06 | +7 % | +56 % | -15 % | -44 % |
| largo corto k5 | -33.6 % | -1.57 | -0.64 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -35 % |
| solo compras k5 | -7.3 % | 0.20 | 0.55 | 71.3 % | 0.87 | +32 % | +50 % | -32 % | -44 % |
| lenta largo corto k5 | -21.2 % | -0.91 | -0.79 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -38 % |
| lenta solo compras k5 | 0.7 % | 0.32 | 0.36 | 67.2 % | 0.10 | +19 % | +120 % | -34 % | -41 % |
| lenta largo corto k5 un dia tarde | -21.7 % | -0.94 | -0.82 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -35 % |
| lenta solo compras k5 un dia tarde | 2.5 % | 0.34 | 0.39 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -42 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.069** (t = 11.8); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 8.6). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -1.9 % al año, Sharpe 0.32, caída máxima 74.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 5.0 % | 0.33 | 1.08 | 49.5 % | 1.21 | -16 % | -12 % | +40 % | +15 % |
| solo compras k3 | 53.4 % | 0.97 | 1.44 | 42.6 % | 1.20 | +11 % | +121 % | +65 % | +22 % |
| largo corto k5 | 3.4 % | 0.26 | 1.18 | 39.1 % | 1.10 | -16 % | -7 % | +49 % | -2 % |
| solo compras k5 | 30.2 % | 0.73 | 1.17 | 44.1 % | 1.08 | +17 % | +118 % | +10 % | -4 % |
| lenta largo corto k5 | 5.5 % | 0.33 | 0.67 | 35.7 % | 0.41 | -18 % | +30 % | +8 % | +6 % |
| lenta solo compras k5 | 21.9 % | 0.63 | 0.79 | 45.5 % | 0.40 | +38 % | +131 % | -16 % | -21 % |
| lenta largo corto k5 un dia tarde | -17.6 % | -0.50 | -0.15 | 56.8 % | 0.41 | -21 % | -3 % | -31 % | -9 % |
| lenta solo compras k5 un dia tarde | -4.1 % | 0.24 | 0.41 | 73.9 % | 0.40 | +32 % | +79 % | -32 % | -46 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
