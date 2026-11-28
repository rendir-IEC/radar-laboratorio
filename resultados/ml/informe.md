# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.053** (t = 7.0); positivo el 58 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.049 (t = 6.4). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 15.1 % al año, Sharpe 0.55, caída máxima 65.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -42.0 % | -1.46 | -0.64 | 88.7 % | 1.07 | -19 % | -59 % | -28 % | -46 % |
| solo compras k3 | -7.2 % | 0.21 | 0.63 | 71.2 % | 1.06 | +7 % | +56 % | -15 % | -47 % |
| largo corto k5 | -33.3 % | -1.56 | -0.62 | 80.0 % | 0.88 | -17 % | -47 % | -25 % | -34 % |
| solo compras k5 | -6.1 % | 0.22 | 0.57 | 70.9 % | 0.87 | +32 % | +50 % | -32 % | -41 % |
| lenta largo corto k5 | -20.7 % | -0.89 | -0.77 | 62.0 % | 0.11 | -28 % | -14 % | +7 % | -36 % |
| lenta solo compras k5 | 1.0 % | 0.32 | 0.36 | 67.0 % | 0.10 | +19 % | +120 % | -34 % | -40 % |
| lenta largo corto k5 un dia tarde | -21.5 % | -0.94 | -0.82 | 64.5 % | 0.11 | -30 % | -17 % | +5 % | -34 % |
| lenta solo compras k5 un dia tarde | 3.2 % | 0.35 | 0.40 | 70.0 % | 0.10 | +24 % | +144 % | -37 % | -40 % |

## Universo: amplio (60 monedas), desde 2023-03-02 (1367 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.068** (t = 11.6); positivo el 63 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.047 (t = 8.0). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 0.1 % al año, Sharpe 0.35, caída máxima 74.7 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 3.4 % | 0.29 | 1.06 | 39.6 % | 1.24 | -20 % | +45 % | +12 % | -12 % |
| solo compras k3 | 20.8 % | 0.61 | 1.05 | 60.6 % | 1.22 | +51 % | +167 % | -39 % | -18 % |
| largo corto k5 | 8.8 % | 0.43 | 1.34 | 34.4 % | 1.10 | -0 % | +34 % | +19 % | -13 % |
| solo compras k5 | 24.7 % | 0.66 | 1.09 | 56.0 % | 1.06 | +69 % | +137 % | -30 % | -18 % |
| lenta largo corto k5 | 2.2 % | 0.23 | 0.56 | 47.5 % | 0.42 | -9 % | +1 % | +42 % | -17 % |
| lenta solo compras k5 | 28.1 % | 0.71 | 0.87 | 51.5 % | 0.40 | +52 % | +98 % | -2 % | -14 % |
| lenta largo corto k5 un dia tarde | -26.4 % | -0.80 | -0.46 | 72.9 % | 0.42 | -20 % | -37 % | -6 % | -33 % |
| lenta solo compras k5 un dia tarde | -2.0 % | 0.28 | 0.44 | 56.9 % | 0.40 | +47 % | +9 % | -12 % | -34 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
