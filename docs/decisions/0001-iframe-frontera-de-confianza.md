# 0001 — El iframe de Auco es la frontera de confianza

- **Estado:** aceptada (2026-10-01)
- **Contexto:** [RFC #2 §1](https://github.com/Lob26/auco-sdk/issues/2), [auditoría #1 §6](https://github.com/Lob26/auco-sdk/issues/1)

## Contexto

La v2 tiene que exponer un componente de firma. Hay dos maneras de construirlo:

1. **Nativa:** el SDK dibuja el documento (PDF.js), captura la firma, el OTP y la selfie, y habla directo con la API de Auco.
2. **Envolvente:** el SDK es dueño del iframe de Auco (`sign.auco.ai`, `veriface.auco.ai`, …) y de todo lo que lo rodea. La firma ocurre adentro del iframe.

## Decisión

**Envolvente.** El SDK nunca captura evidencia de firma ni de identidad. Lo nativo se gana en el contenedor: estados de carga y error, accesibilidad, theming, el modelo de eventos y la integración con formularios.

## Por qué

- **No hay contra qué hablar.** La API v1.5 no tiene ningún endpoint del lado del firmante. Todo se autentica con llaves de la empresa (`puk_` lee, `prk_` escribe).
- **Validez legal.** En Colombia (Ley 527 de 1999, Decreto 2364 de 2012) la firma electrónica vale por la evidencia que la acompaña: OTP, biometría, IP y sello de tiempo. Esa cadena la construye la app de Auco, y moverla a una UI de terceros es una conversación legal con Auco, no una decisión de SDK.
- **La biometría es producto.** Liveness y comparación facial son `veriface`. Rehacerlas sería rehacer el producto.
- **WASM no aplica.** El SDK orquesta DOM, iframe y `postMessage`, cosas que WASM no toca sin glue de JS. Un módulo WASM mínimo pesa más que todo el presupuesto del núcleo (≤ 3 KB gzip).

## Consecuencias

- El protocolo `postMessage` es el contrato central y se documenta en `packages/protocol/PROTOCOL.md`.
- La seguridad del host depende de filtrar cada mensaje por `origin` **y** `source` (auditoría 1.1). Eso pasa a ser un invariante de `embed`.
- **Reversible:** si Auco expone endpoints del lado del firmante, esta decisión se reabre en una RFC nueva. Nada de la arquitectura por capas lo impide.
