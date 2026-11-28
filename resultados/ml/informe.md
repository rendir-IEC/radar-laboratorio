# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.049 (t = 6.4). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 15.1 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -42.3 % | -1.47 | -0.65 | 88.8 % | 1.07 | -19 % | -59 % | -28 % | -46 % |
| solo compras k3 | -8.6 % | 0.19 | 0.60 | 72.6 % | 1.06 | +7 % | +56 % | -15 % | -50 % |
| largo corto k5 | -33.5 % | -1.57 | -0.64 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -34 % |
| solo compras k5 | -6.8 % | 0.20 | 0.56 | 70.9 % | 0.87 | +32 % | +50 % | -32 % | -43 % |
| lenta largo corto k5 | -21.4 % | -0.92 | -0.80 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -38 % |
| lenta solo compras k5 | 0.3 % | 0.31 | 0.35 | 67.6 % | 0.10 | +19 % | +120 % | -34 % | -42 % |
| lenta largo corto k5 un dia tarde | -21.9 % | -0.95 | -0.84 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -35 % |
| lenta solo compras k5 un dia tarde | 2.1 % | 0.34 | 0.38 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -43 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.069** (t = 11.8); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 8.6). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -1.9 % al año, Sharpe 0.32, caída máxima 74.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -0.5 % | 0.20 | 0.95 | 49.5 % | 1.22 | -16 % | -12 % | +40 % | -6 % |
| solo compras k3 | 48.3 % | 0.92 | 1.38 | 47.6 % | 1.20 | +11 % | +121 % | +65 % | +7 % |
| largo corto k5 | 1.5 % | 0.20 | 1.12 | 39.1 % | 1.10 | -16 % | -7 % | +49 % | -9 % |
| solo compras k5 | 29.4 % | 0.72 | 1.16 | 44.1 % | 1.08 | +17 % | +118 % | +10 % | -6 % |
| lenta largo corto k5 | 3.4 % | 0.26 | 0.60 | 35.7 % | 0.41 | -18 % | +30 % | +8 % | -2 % |
| lenta solo compras k5 | 21.4 % | 0.62 | 0.79 | 46.2 % | 0.41 | +38 % | +131 % | -16 % | -22 % |
| lenta largo corto k5 un dia tarde | -18.8 % | -0.55 | -0.19 | 56.8 % | 0.41 | -21 % | -3 % | -31 % | -14 % |
| lenta solo compras k5 un dia tarde | -7.2 % | 0.19 | 0.36 | 73.7 % | 0.41 | +32 % | +79 % | -32 % | -52 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
