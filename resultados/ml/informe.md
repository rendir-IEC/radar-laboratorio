# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.049 (t = 6.5). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 15.1 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -42.1 % | -1.46 | -0.64 | 88.8 % | 1.07 | -19 % | -59 % | -28 % | -46 % |
| solo compras k3 | -6.5 % | 0.23 | 0.64 | 70.8 % | 1.06 | +7 % | +56 % | -15 % | -45 % |
| largo corto k5 | -33.4 % | -1.56 | -0.63 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -34 % |
| solo compras k5 | -7.0 % | 0.20 | 0.56 | 71.0 % | 0.87 | +32 % | +50 % | -32 % | -43 % |
| lenta largo corto k5 | -21.4 % | -0.92 | -0.80 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -38 % |
| lenta solo compras k5 | 1.2 % | 0.32 | 0.36 | 67.0 % | 0.10 | +19 % | +120 % | -34 % | -40 % |
| lenta largo corto k5 un dia tarde | -21.5 % | -0.93 | -0.81 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -34 % |
| lenta solo compras k5 un dia tarde | 3.2 % | 0.36 | 0.40 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -40 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.071** (t = 11.8); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 8.2). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -0.6 % al año, Sharpe 0.34, caída máxima 74.6 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -7.4 % | 0.03 | 0.77 | 51.3 % | 1.22 | -19 % | -20 % | +35 % | -13 % |
| solo compras k3 | 22.6 % | 0.64 | 1.11 | 48.8 % | 1.19 | -6 % | +143 % | +21 % | -22 % |
| largo corto k5 | -3.7 % | 0.04 | 0.91 | 45.1 % | 1.08 | -9 % | -10 % | +13 % | -6 % |
| solo compras k5 | 26.1 % | 0.68 | 1.12 | 50.1 % | 1.04 | +29 % | +155 % | -21 % | -9 % |
| lenta largo corto k5 | -2.6 % | 0.07 | 0.41 | 41.4 % | 0.41 | -1 % | -2 % | +4 % | -10 % |
| lenta solo compras k5 | 16.2 % | 0.55 | 0.72 | 54.6 % | 0.40 | +34 % | +108 % | -20 % | -21 % |
| lenta largo corto k5 un dia tarde | -26.1 % | -0.83 | -0.48 | 70.3 % | 0.41 | -28 % | -34 % | -20 % | -16 % |
| lenta solo compras k5 un dia tarde | -10.6 % | 0.10 | 0.28 | 67.9 % | 0.40 | +37 % | +14 % | -30 % | -40 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
