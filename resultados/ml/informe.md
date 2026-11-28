# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.049 (t = 6.4). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 15.1 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -42.0 % | -1.45 | -0.64 | 88.8 % | 1.07 | -19 % | -59 % | -28 % | -46 % |
| solo compras k3 | -7.3 % | 0.21 | 0.63 | 71.5 % | 1.06 | +7 % | +56 % | -15 % | -47 % |
| largo corto k5 | -33.6 % | -1.57 | -0.64 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -34 % |
| solo compras k5 | -7.1 % | 0.20 | 0.55 | 71.1 % | 0.87 | +32 % | +50 % | -32 % | -44 % |
| lenta largo corto k5 | -21.4 % | -0.92 | -0.80 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -38 % |
| lenta solo compras k5 | -0.0 % | 0.30 | 0.35 | 67.2 % | 0.10 | +19 % | +120 % | -34 % | -42 % |
| lenta largo corto k5 un dia tarde | -22.0 % | -0.96 | -0.84 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -36 % |
| lenta solo compras k5 un dia tarde | 2.1 % | 0.34 | 0.38 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -43 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.069** (t = 11.8); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 8.5). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -1.9 % al año, Sharpe 0.32, caída máxima 74.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 2.8 % | 0.28 | 1.03 | 49.5 % | 1.22 | -16 % | -12 % | +40 % | +7 % |
| solo compras k3 | 49.4 % | 0.93 | 1.40 | 46.1 % | 1.20 | +11 % | +121 % | +65 % | +10 % |
| largo corto k5 | 2.8 % | 0.24 | 1.16 | 39.1 % | 1.10 | -16 % | -7 % | +49 % | -4 % |
| solo compras k5 | 30.4 % | 0.73 | 1.18 | 44.1 % | 1.08 | +17 % | +118 % | +10 % | -4 % |
| lenta largo corto k5 | 3.7 % | 0.27 | 0.61 | 35.7 % | 0.41 | -18 % | +30 % | +8 % | -1 % |
| lenta solo compras k5 | 20.3 % | 0.61 | 0.77 | 48.0 % | 0.40 | +38 % | +131 % | -16 % | -25 % |
| lenta largo corto k5 un dia tarde | -21.4 % | -0.65 | -0.30 | 61.4 % | 0.41 | -21 % | -3 % | -31 % | -24 % |
| lenta solo compras k5 un dia tarde | -8.4 % | 0.17 | 0.33 | 74.9 % | 0.40 | +32 % | +79 % | -32 % | -55 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
