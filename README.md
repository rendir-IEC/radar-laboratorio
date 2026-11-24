# radar-laboratorio

Sistema que aprende de los mercados, **en papel**. No mueve dinero, no da órdenes a ningún bróker y no garantiza ganancias. Es una herramienta de investigación personal y no asesoramiento financiero.

## Qué hay aquí

| Carpeta | Qué es | Estado |
|---|---|---|
| `servidor/` | Worker de Cloudflare (`worker.js`, v2.1.0). Guarda precios, funding, carteras seguidas y flujo de órdenes de Hyperliquid, y hace aprender cada hora a 22 «expertos» (tendencia, impulso, rebote, funding, flujo de órdenes, copiar carteras) con pesos multiplicativos. Somete a cada uno a una prueba contra la suerte (Sharpe deflactado). | v2.1.0 pendiente de instalar; instalada la v2.0.1 (`servidor/historial/`) |
| `laboratorio/` | Búsqueda masiva de estrategias en años de historia horaria con máquinas gratuitas de GitHub Actions. Usa validación fuera de muestra, corrige por el número de pruebas (Sharpe deflactado y probabilidad de sobreajuste) y exporta las ganadoras para que compitan en vivo en el servidor. | En construcción |

## Pruebas del servidor

Necesitan Node 22 o superior. No hace falta red, porque Hyperliquid se simula:

```
cd servidor
node pruebas/prueba_v21.mjs        # repaso de 5000 h + 8 h en vivo, límites de CPU y de peticiones
node pruebas/prueba_migracion.mjs  # de la v2.0.1 a la v2.1 sobre la misma base de datos
node pruebas/prueba_bitstamp.mjs   # paginación del histórico diario
```

Los resultados de rentabilidad de estas pruebas salen de precios sintéticos (senoides) y **no dicen nada** sobre el mercado real. Solo comprueban que el código funciona.

## Secretos

No hay ninguno en el repositorio. El Worker lee `TOKEN` de los secretos de Cloudflare.
