# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.055** (t = 7.2); positivo el 57 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.052 (t = 6.8). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 21.6 % al año, Sharpe 0.63, caída máxima 64.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |
|---|---|---|---|---|---|
| largo corto k3 | -25.8 % | -0.71 | 0.09 | 76.3 % | 1.05 |
| solo compras k3 | 8.8 % | 0.46 | 0.85 | 67.4 % | 1.03 |
| largo corto k5 | -25.5 % | -1.09 | -0.16 | 70.5 % | 0.88 |
| solo compras k5 | 1.1 % | 0.34 | 0.68 | 71.8 % | 0.86 |
| lenta largo corto k5 | -13.8 % | -0.53 | -0.41 | 54.5 % | 0.11 |
| lenta solo compras k5 | 16.1 % | 0.55 | 0.59 | 61.4 % | 0.10 |
| lenta largo corto k5 un dia tarde | -17.0 % | -0.68 | -0.56 | 55.0 % | 0.11 |
| lenta solo compras k5 un dia tarde | 15.7 % | 0.54 | 0.59 | 62.4 % | 0.10 |

## Universo: amplio (60 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.076** (t = 13.2); positivo el 64 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.053 (t = 9.2). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): 2.4 % al año, Sharpe 0.38, caída máxima 73.5 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |
|---|---|---|---|---|---|
| largo corto k3 | 46.5 % | 1.13 | 1.88 | 52.2 % | 1.23 |
| solo compras k3 | 48.8 % | 0.92 | 1.38 | 49.2 % | 1.22 |
| largo corto k5 | 18.7 % | 0.70 | 1.59 | 42.8 % | 1.10 |
| solo compras k5 | 38.2 % | 0.83 | 1.26 | 46.8 % | 1.07 |
| lenta largo corto k5 | 12.5 % | 0.53 | 0.85 | 46.6 % | 0.42 |
| lenta solo compras k5 | 69.1 % | 1.15 | 1.32 | 41.9 % | 0.41 |
| lenta largo corto k5 un dia tarde | -10.8 % | -0.22 | 0.13 | 61.6 % | 0.42 |
| lenta solo compras k5 un dia tarde | 13.7 % | 0.52 | 0.69 | 69.7 % | 0.41 |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría). El universo de cada momento está en resultados/universo. 8 variantes de cartera fijadas de antemano: hay que confirmarlo en vivo.
