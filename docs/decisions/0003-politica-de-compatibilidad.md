# 0003 — Compatibilidad: la 1.x se congela, se caracteriza y se reimplementa como `compat`

- **Estado:** aceptada (2026-10-01)
- **Contexto:** [RFC #2 §3](https://github.com/Lob26/auco-sdk/issues/2), [auditoría #1](https://github.com/Lob26/auco-sdk/issues/1)

## Contexto

`auco-sdk-integration@1.0.9` tiene alrededor de 1.000 descargas al mes e integraciones en producción. La v2 cambia de paradigma: sesión dueña del iframe, Custom Elements y errores tipados. Si se le exige a todos migrar de golpe, nadie migra.

## Decisión

1. **Fase 0:** la 1.0.9 vive en `packages/legacy` **sin cambios de comportamiento ni de API.** Solo cambian el layout y el toolchain.
2. **Fase 0:** una suite de caracterización fija lo que la 1.0.9 hace hoy, usando las fixtures del protocolo. Cada defecto 🔴 de la auditoría tiene un `it.fails` que afirma el comportamiento **correcto**.
3. **Fase 1:** `compat` exporta `AucoSDK(config)` con la **misma firma 1.x**, implementado sobre `embed`. Pasa la suite de caracterización salvo los `it.fails`, que se vuelven `it`: así queda probado que corrige los defectos sin romper lo demás.
4. `keyPrivate` y la exigencia de `iframeId` quedan deprecados en `compat` y desaparecen en la API v2.

## Por qué

Una reescritura sin una línea base ejecutable cambia comportamientos sin que nadie lo note. La suite convierte "compatible" en un comando con exit code.

## Consecuencias

- **Arreglar un defecto de la 1.x dentro de `packages/legacy` está prohibido:** se arregla en `compat`. `legacy` es la línea base y se borra cuando `compat` la reemplace (fase 5).
- **Breaking intencional:** un integrador que dependa de un defecto (por ejemplo, el cross-talk entre iframes) verá el cambio. Se documenta en la guía de migración.
