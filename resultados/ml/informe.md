# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.055** (t = 7.1); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.051 (t = 6.7). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 14.7 % al año, Sharpe 0.54, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -41.0 % | -1.40 | -0.58 | 88.7 % | 1.07 | -19 % | -59 % | -28 % | -42 % |
| solo compras k3 | -5.7 % | 0.24 | 0.65 | 70.0 % | 1.06 | +7 % | +56 % | -15 % | -44 % |
| largo corto k5 | -32.8 % | -1.52 | -0.59 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -31 % |
| solo compras k5 | -6.3 % | 0.21 | 0.57 | 70.9 % | 0.87 | +32 % | +50 % | -32 % | -42 % |
| lenta largo corto k5 | -19.9 % | -0.84 | -0.72 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -33 % |
| lenta solo compras k5 | 0.9 % | 0.32 | 0.36 | 67.0 % | 0.10 | +19 % | +120 % | -34 % | -41 % |
| lenta largo corto k5 un dia tarde | -20.6 % | -0.88 | -0.76 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -31 % |
| lenta solo compras k5 un dia tarde | 3.3 % | 0.36 | 0.40 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -40 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.074** (t = 12.7); positivo el 64 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.049 (t = 8.5). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -2.6 % al año, Sharpe 0.31, caída máxima 74.1 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 4.7 % | 0.32 | 1.09 | 52.6 % | 1.26 | -35 % | +78 % | +17 % | -12 % |
| solo compras k3 | 14.5 % | 0.53 | 1.00 | 50.9 % | 1.22 | -18 % | +171 % | +17 % | -36 % |
| largo corto k5 | 23.3 % | 0.83 | 1.74 | 32.5 % | 1.12 | -10 % | +44 % | +46 % | +16 % |
| solo compras k5 | 30.2 % | 0.73 | 1.16 | 44.2 % | 1.08 | +1 % | +277 % | -4 % | -26 % |
| lenta largo corto k5 | 7.1 % | 0.38 | 0.73 | 56.1 % | 0.43 | -21 % | +33 % | +40 % | -12 % |
| lenta solo compras k5 | 25.7 % | 0.68 | 0.85 | 46.2 % | 0.41 | +33 % | +126 % | +10 % | -29 % |
| lenta largo corto k5 un dia tarde | -26.2 % | -0.86 | -0.49 | 72.1 % | 0.43 | -29 % | -33 % | -2 % | -31 % |
| lenta solo compras k5 un dia tarde | -0.5 % | 0.29 | 0.47 | 61.8 % | 0.41 | +31 % | +56 % | -10 % | -47 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
