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

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.072** (t = 12.4); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.053 (t = 9.1). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -1.4 % al año, Sharpe 0.33, caída máxima 74.6 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 4.3 % | 0.31 | 1.07 | 42.5 % | 1.22 | +2 % | +0 % | +41 % | -19 % |
| solo compras k3 | 60.2 % | 1.04 | 1.51 | 48.8 % | 1.20 | +23 % | +171 % | +63 % | +8 % |
| largo corto k5 | 20.0 % | 0.73 | 1.61 | 26.9 % | 1.09 | +13 % | +58 % | +23 % | -10 % |
| solo compras k5 | 49.6 % | 0.95 | 1.37 | 49.3 % | 1.07 | +70 % | +236 % | +5 % | -24 % |
| lenta largo corto k5 | 17.1 % | 0.66 | 1.00 | 36.1 % | 0.42 | -8 % | +45 % | +38 % | -2 % |
| lenta solo compras k5 | 43.9 % | 0.90 | 1.06 | 47.3 % | 0.39 | +53 % | +138 % | +29 % | -17 % |
| lenta largo corto k5 un dia tarde | -20.7 % | -0.62 | -0.26 | 63.0 % | 0.42 | -21 % | -19 % | -4 % | -31 % |
| lenta solo compras k5 un dia tarde | 0.2 % | 0.31 | 0.47 | 59.9 % | 0.39 | +32 % | +46 % | -2 % | -47 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
