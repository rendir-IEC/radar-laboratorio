# Aprendizaje automático (estilo Qlib) — todo fuera de muestra

> Un modelo LightGBM aprende a ordenar las monedas por lo que subirán mañana, con 101 indicadores inspirados en Alpha158 de Qlib (Microsoft Research Asia, MIT) más funding, compras agresivas y relación con BTC. Se reentrena cada 30 días solo con el pasado. Investigación en papel.

## Universo: servidor (20 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.055** (t = 7.2); positivo el 57 % de los días. 0 = no sabe nada.
- Referencia (todas comprado a partes iguales): 21.6 % al año, Sharpe 0.63, caída máxima 64.2 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |
|---|---|---|---|---|---|
| largo corto k3 | -26.2 % | -0.73 | 0.07 | 76.3 % | 1.06 |
| solo compras k3 | 8.6 % | 0.45 | 0.85 | 67.4 % | 1.03 |
| largo corto k5 | -25.6 % | -1.10 | -0.17 | 70.5 % | 0.88 |
| solo compras k5 | 0.6 % | 0.33 | 0.68 | 71.8 % | 0.87 |

## Universo: amplio (60 monedas), desde 2023-03-02 (1364 días fuera de muestra)

- Acierto en el orden (IC medio, correlación de rangos entre lo previsto y lo que pasó): **0.076** (t = 13.2); positivo el 64 % de los días. 0 = no sabe nada.
- Referencia (todas comprado a partes iguales): 2.4 % al año, Sharpe 0.38, caída máxima 73.5 %.

| Cartera | Rent. anual | Sharpe | Sharpe sin costes | Caída máx. | Giro diario |
|---|---|---|---|---|---|
| largo corto k3 | 50.8 % | 1.20 | 1.95 | 52.2 % | 1.23 |
| solo compras k3 | 52.4 % | 0.96 | 1.42 | 49.2 % | 1.22 |
| largo corto k5 | 20.9 % | 0.76 | 1.65 | 42.8 % | 1.10 |
| solo compras k5 | 42.1 % | 0.87 | 1.31 | 46.8 % | 1.07 |

Nota: universo elegido con las monedas de hoy (sesgo de supervivencia, D-I2 de la auditoría); 8 variantes de cartera probadas: con tan pocas, el listón contra la suerte es bajo, pero hay que confirmarlo en vivo.
