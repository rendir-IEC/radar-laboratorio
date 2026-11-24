# Laboratorio

Busca estrategias con ventaja **real** (después de costes y corrigiendo la suerte) en años de historia horaria,
y exporta las ganadoras para que compitan en vivo en el servidor. Todo en papel.

## Cómo trabaja (`.github/workflows/laboratorio.yml`, cada día y a mano)
1. **pruebas**: las del laboratorio y las del servidor, sin red.
2. **datos**: data.binance.vision (velas de 1 h y funding de futuros USDT-M desde 2021) + Hyperliquid (lo
   reciente, las monedas que Binance no tiene y su funding horario). Caché entre ejecuciones. Universo: las 20 del
   servidor + las de más volumen de Hyperliquid hasta 60.
3. **buscar**: 4 máquinas en paralelo se reparten la rejilla de 2232 estrategias. Cada una se simula en las 20
   monedas del servidor y en las 60, con las mismas reglas que el servidor (escala por volatilidad, banda sin
   operar del 25 %, comisión 0,045 % + 0,025 % de deslizamiento por unidad de giro, funding pagado).
4. **juntar**: Sharpe deflactado con el número total de pruebas, probabilidad de sobreajuste (CSCV, 16 bloques,
   12 870 particiones), selección paso a paso fuera de muestra (cada trimestre, las 5 mejores con la historia de
   ese momento) y robustez (dos mitades, universo amplio). Publica `resultados/estrategias.json`,
   `resultados/informe.md` y una línea más en `resultados/historial.csv`.

## Rejilla
Señales que el servidor ya sabe calcular con su memoria: tendencia (cruce de medias de 12 h a 1 mes), impulso,
rebote, funding en contra y a favor. Formas: signo o graduada. Modo: por moneda o relativa entre monedas.
Lado: ambos, solo compras, solo ventas. Filtro por la tendencia de BTC. Reajuste cada hora o cada día.

## Pruebas locales
```
pip install -r requirements.txt
python pruebas/prueba_lab.py     # memoria idéntica a la del servidor, sin mirar al futuro, ruido vs ventaja plantada
python pruebas/prueba_datos.py   # descarga y montaje del panel con Binance y Hyperliquid simulados
python -m lab.preparar --sintetico impulso --universo 30 --salida /tmp/p.npz
python -m lab.buscar --panel /tmp/p.npz --salida /tmp/t/trozo_0.npz && python -m lab.juntar --trozos /tmp/t --salida /tmp/r
```

## Limitaciones conocidas
- **Supervivencia**: el universo son las monedas que hoy cotizan con volumen; las que murieron no están.
- Binance y Hyperliquid no tienen exactamente los mismos precios ni el mismo funding; se empalman sin saltos.
- El número de pruebas se cuenta tal cual (2232), sin descontar que muchas se parecen: el listón es prudente.
- Sin datos de libro de órdenes históricos: el flujo de órdenes solo se aprende en vivo en el servidor.
