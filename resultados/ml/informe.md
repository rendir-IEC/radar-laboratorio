# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1366 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 6.6). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 14.9 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -42.0 % | -1.45 | -0.64 | 88.7 % | 1.07 | -19 % | -59 % | -28 % | -45 % |
| solo compras k3 | -7.5 % | 0.21 | 0.62 | 71.4 % | 1.06 | +7 % | +56 % | -15 % | -48 % |
| largo corto k5 | -33.5 % | -1.57 | -0.63 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -34 % |
| solo compras k5 | -6.8 % | 0.20 | 0.56 | 70.9 % | 0.87 | +32 % | +50 % | -32 % | -43 % |
| lenta largo corto k5 | -20.8 % | -0.89 | -0.77 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -36 % |
| lenta solo compras k5 | 0.2 % | 0.31 | 0.35 | 67.5 % | 0.10 | +19 % | +120 % | -34 % | -42 % |
| lenta largo corto k5 un dia tarde | -21.6 % | -0.94 | -0.82 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -34 % |
| lenta solo compras k5 un dia tarde | 1.8 % | 0.33 | 0.38 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -43 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1366 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.069** (t = 11.5); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.047 (t = 8.0). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -2.6 % al año, Sharpe 0.32, caída máxima 75.9 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -10.5 % | -0.07 | 0.69 | 52.2 % | 1.20 | -16 % | +7 % | -16 % | -12 % |
| solo compras k3 | 30.8 % | 0.73 | 1.18 | 45.3 % | 1.16 | +5 % | +184 % | -9 % | +0 % |
| largo corto k5 | 3.1 % | 0.25 | 1.14 | 35.3 % | 1.07 | -4 % | +5 % | +24 % | -11 % |
| solo compras k5 | 38.6 % | 0.83 | 1.25 | 44.5 % | 1.04 | +44 % | +184 % | -8 % | -10 % |
| lenta largo corto k5 | -2.8 % | 0.06 | 0.38 | 36.1 % | 0.38 | -4 % | -14 % | +10 % | -1 % |
| lenta solo compras k5 | 27.3 % | 0.70 | 0.85 | 44.3 % | 0.35 | +82 % | +42 % | +7 % | -11 % |
| lenta largo corto k5 un dia tarde | -14.2 % | -0.37 | -0.04 | 46.9 % | 0.38 | -11 % | -22 % | +5 % | -22 % |
| lenta solo compras k5 un dia tarde | 16.6 % | 0.55 | 0.70 | 49.4 % | 0.35 | +82 % | +15 % | +10 % | -22 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
