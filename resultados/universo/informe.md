# Aprendizaje automático sobre el universo de cada momento (sin sesgo de supervivencia)

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.070 %. Investigación en papel.

## Universo: cada momento, las 20 de más volumen (20 monedas), desde 2022-03-01 (1706 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.110** (t = 15.3); positivo el 63 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.079 (t = 11.0). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -39.3 % al año, Sharpe -0.25, caída máxima 92.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |
|---|---|---|---|---|---|
| largo corto k3 | 53.9 % | 1.11 | 1.60 | 66.1 % | 1.03 |
| solo compras k3 | -3.4 % | 0.29 | 0.66 | 76.0 % | 0.97 |
| largo corto k5 | 47.4 % | 1.18 | 1.71 | 48.5 % | 0.83 |
| solo compras k5 | -3.6 % | 0.30 | 0.58 | 76.2 % | 0.79 |
| lenta largo corto k5 | 33.9 % | 1.03 | 1.11 | 35.6 % | 0.10 |
| lenta solo compras k5 | -15.7 % | 0.11 | 0.14 | 86.3 % | 0.09 |
| lenta largo corto k5 un dia tarde | 25.4 % | 0.84 | 0.92 | 30.1 % | 0.10 |
| lenta solo compras k5 un dia tarde | -22.3 % | -0.01 | 0.02 | 86.7 % | 0.09 |

## Universo: cada momento, las 60 de más volumen (60 monedas), desde 2022-03-01 (1706 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.112** (t = 22.8); positivo el 70 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.077 (t = 15.7). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -37.6 % al año, Sharpe -0.22, caída máxima 92.3 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |
|---|---|---|---|---|---|
| largo corto k3 | 122.6 % | 1.70 | 2.26 | 55.4 % | 1.26 |
| solo compras k3 | 7.3 % | 0.44 | 0.89 | 73.1 % | 1.17 |
| largo corto k5 | 94.2 % | 1.71 | 2.36 | 33.4 % | 1.14 |
| solo compras k5 | 7.5 % | 0.44 | 0.86 | 69.8 % | 1.08 |
| lenta largo corto k5 | 95.6 % | 1.72 | 1.99 | 47.0 % | 0.48 |
| lenta solo compras k5 | 11.9 % | 0.50 | 0.69 | 70.5 % | 0.49 |
| lenta largo corto k5 un dia tarde | 25.8 % | 0.74 | 1.02 | 46.6 % | 0.48 |
| lenta solo compras k5 un dia tarde | -6.2 % | 0.24 | 0.43 | 65.6 % | 0.49 |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Universo de cada momento: cada mes, los perpetuos USDT-M de Binance con más volumen el mes anterior, incluidos los que después se retiraron (su último día cuenta como cierre al último precio). Velas diarias de Binance. 8 variantes de cartera fijadas de antemano.

## Universos

Símbolos USDT-M con datos (incluidos los retirados): 913.
- Las 20 de más volumen cada mes: pasan 221 símbolos distintos; 9 ya no cotizan (p. ej. EOSUSDT, GALUSDT, LENDUSDT, LUNAUSDT, MATICUSDT, RNDRUSDT, SXPUSDT, TOMOUSDT, YFIIUSDT).
- Las 60 de más volumen cada mes: pasan 490 símbolos distintos; 20 ya no cotizan (p. ej. AERGOUSDT, ANTUSDT, AUDIOUSDT, BTTUSDT, BZRXUSDT, COCOSUSDT, DODOUSDT, EOSUSDT, FRONTUSDT, GALUSDT).
