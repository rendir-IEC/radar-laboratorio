# Aprendizaje automático sobre el universo de cada momento (sin sesgo de supervivencia)

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Coste por cada 100 % de giro: 0.100 %. Investigación en papel.

## Universo: cada momento, las 20 de más volumen (20 monedas), desde 2022-03-01 (1706 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.110** (t = 15.6); positivo el 64 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.079 (t = 11.2). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -31.9 % al año, Sharpe -0.09, caída máxima 89.0 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | -1.2 % | 0.30 | 0.96 | 87.0 % | 1.01 | +102 % | +12 % | +65 % | -30 % | -64 % |
| solo compras k3 | -29.3 % | -0.15 | 0.34 | 82.0 % | 0.94 | -79 % | +122 % | +50 % | -10 % | -68 % |
| largo corto k5 | 10.6 % | 0.46 | 1.17 | 65.9 % | 0.83 | +105 % | +2 % | +63 % | -8 % | -49 % |
| solo compras k5 | -13.0 % | 0.17 | 0.56 | 70.0 % | 0.78 | -65 % | +125 % | +53 % | -36 % | -32 % |
| lenta largo corto k5 | 17.4 % | 0.62 | 0.73 | 41.1 % | 0.10 | +69 % | -10 % | +60 % | +32 % | -34 % |
| lenta solo compras k5 | 2.9 % | 0.38 | 0.42 | 69.4 % | 0.09 | -62 % | +92 % | +85 % | -25 % | +13 % |
| lenta largo corto k5 un dia tarde | 21.3 % | 0.72 | 0.82 | 37.4 % | 0.10 | +49 % | -19 % | +54 % | +42 % | -6 % |
| lenta solo compras k5 un dia tarde | 3.9 % | 0.40 | 0.44 | 69.7 % | 0.09 | -63 % | +68 % | +79 % | -16 % | +28 % |

## Universo: cada momento, las 60 de más volumen (60 monedas), desde 2022-03-01 (1706 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.110** (t = 22.8); positivo el 71 % de los días. 0 = no sabe nada.
- Entrando un día más tarde: IC 0.076 (t = 15.5). Si se mantiene, la ventaja no depende del precio exacto de cierre.
- Referencia (todas comprado a partes iguales): -34.9 % al año, Sharpe -0.16, caída máxima 90.6 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|
| largo corto k3 | 60.2 % | 1.11 | 1.89 | 73.5 % | 1.27 | +50 % | -17 % | +312 % | +118 % | -19 % |
| solo compras k3 | -22.9 % | -0.02 | 0.58 | 79.7 % | 1.15 | -74 % | +71 % | +173 % | -39 % | -60 % |
| largo corto k5 | 39.0 % | 0.94 | 1.82 | 74.7 % | 1.15 | +41 % | -12 % | +217 % | +119 % | -46 % |
| solo compras k5 | -15.8 % | 0.09 | 0.66 | 78.2 % | 1.06 | -73 % | +72 % | +97 % | -15 % | -42 % |
| lenta largo corto k5 | 45.5 % | 1.05 | 1.43 | 69.7 % | 0.48 | +69 % | -6 % | +128 % | +117 % | -26 % |
| lenta solo compras k5 | 1.1 % | 0.36 | 0.61 | 72.9 % | 0.47 | -60 % | +87 % | +92 % | -15 % | -12 % |
| lenta largo corto k5 un dia tarde | -14.2 % | -0.09 | 0.29 | 75.5 % | 0.48 | -10 % | -10 % | -13 % | +27 % | -45 % |
| lenta solo compras k5 un dia tarde | -17.3 % | 0.07 | 0.32 | 74.2 % | 0.47 | -66 % | +100 % | +8 % | -22 % | -28 % |

«Lenta»: una moneda se mantiene mientras siga entre las 15 mejores (o peores), así se opera mucho menos. «Un día tarde»: la misma cartera lenta, pero entrando al cierre del día siguiente.

Universo de cada momento: cada mes, los perpetuos USDT-M de Binance con más volumen el mes anterior, incluidos los que después se retiraron (su último día cuenta como cierre al último precio), sin oro, petróleo ni acciones. El rendimiento incluye el funding (el comprado paga si es positivo; el vendido cobra). Coste prudente de 0,10 %% por cada 100 %% de giro (lo que cuestan las monedas medianas en Kraken Futuros). Velas diarias de Binance. 8 variantes de cartera fijadas de antemano.

## Universos

Símbolos USDT-M con datos (incluidos los retirados): 749. Fuera por no ser cripto (oro, petróleo, acciones, fondos): 164 (AAOI, AAPL, ADBE, ALAB, AMAT, AMD, AMZN, APP, ARM, ASML, ASTS, AVGO, AXTI, BABA, BE, BITO, BMNR, BOT, BSP, BTCST, BX, BZ, CAT, CBRS, CIEN, CL, COHR, COIN, COPPER, COST, CRCL, CRDO, CRM, CRWD, CRWV, CSCO, CSOPSAMSUNG2L, CXMT, DDOG, DELL).
- Las 20 de más volumen cada mes: pasan 222 símbolos distintos; 9 ya no cotizan (p. ej. EOSUSDT, GALUSDT, LENDUSDT, LUNAUSDT, MATICUSDT, RNDRUSDT, SXPUSDT, TOMOUSDT, YFIIUSDT).
- Las 60 de más volumen cada mes: pasan 484 símbolos distintos; 20 ya no cotizan (p. ej. AERGOUSDT, ANTUSDT, AUDIOUSDT, BTTUSDT, BZRXUSDT, COCOSUSDT, DODOUSDT, EOSUSDT, FRONTUSDT, GALUSDT).
