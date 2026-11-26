# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1365 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.054** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.050 (t = 6.6). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 15.2 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -41.8 % | -1.44 | -0.63 | 88.7 % | 1.07 | -19 % | -59 % | -28 % | -45 % |
| solo compras k3 | -6.9 % | 0.22 | 0.63 | 71.2 % | 1.06 | +7 % | +56 % | -15 % | -46 % |
| largo corto k5 | -33.2 % | -1.55 | -0.61 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -33 % |
| solo compras k5 | -6.4 % | 0.21 | 0.57 | 71.0 % | 0.87 | +32 % | +50 % | -32 % | -42 % |
| lenta largo corto k5 | -20.4 % | -0.86 | -0.74 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -35 % |
| lenta solo compras k5 | 0.8 % | 0.32 | 0.36 | 67.6 % | 0.10 | +19 % | +120 % | -34 % | -41 % |
| lenta largo corto k5 un dia tarde | -21.1 % | -0.91 | -0.79 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -33 % |
| lenta solo compras k5 un dia tarde | 3.1 % | 0.35 | 0.40 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -41 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1365 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.069** (t = 11.5); positivo el 62 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.048 (t = 8.1). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 0.8 % al año, Sharpe 0.36, caída máxima 73.9 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -0.3 % | 0.19 | 0.99 | 52.3 % | 1.23 | +5 % | +17 % | -29 % | +14 % |
| solo compras k3 | 36.4 % | 0.80 | 1.27 | 51.6 % | 1.19 | +69 % | +139 % | -25 % | +5 % |
| largo corto k5 | -0.5 % | 0.14 | 1.03 | 42.3 % | 1.10 | -5 % | +0 % | +6 % | -3 % |
| solo compras k5 | 21.4 % | 0.62 | 1.06 | 55.6 % | 1.06 | +38 % | +168 % | -28 % | -22 % |
| lenta largo corto k5 | 6.5 % | 0.36 | 0.69 | 43.2 % | 0.41 | +6 % | -0 % | -1 % | +20 % |
| lenta solo compras k5 | 23.6 % | 0.65 | 0.81 | 48.7 % | 0.38 | +48 % | +103 % | -12 % | -16 % |
| lenta largo corto k5 un dia tarde | -11.0 % | -0.22 | 0.12 | 52.2 % | 0.41 | -6 % | -16 % | -16 % | -2 % |
| lenta solo compras k5 un dia tarde | 10.3 % | 0.46 | 0.62 | 61.1 % | 0.38 | +39 % | +84 % | -21 % | -28 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
