# 0002 — Nombre del paquete: comunitario hasta que Auco lo adopte

- **Estado:** aceptada (2026-10-01). El nombre definitivo queda pendiente.
- **Contexto:** [RFC #2 §3](https://github.com/Lob26/auco-sdk/issues/2), [hoja de ruta #3](https://github.com/Lob26/auco-sdk/issues/3)

## Contexto

`auco-sdk-integration` es de Auco en npm (mantenedor: `alejoav`). Este repo es un fork comunitario sin aval de Auco, al menos todavía.

## Decisión

- **Nada se publica bajo el scope `@auco`, ni con la marca de Auco presentada como oficial,** mientras Auco no adopte el proyecto.
- La copia de la 1.x en `packages/legacy` conserva el nombre `auco-sdk-integration` porque es la misma librería, pero lleva `"private": true`. El fork nunca puede publicar sobre el paquete de upstream.
- Los paquetes v2 usan un nombre comunitario y neutro, que se fija antes de la primera publicación (fase 5). Debe dejar claro que es un SDK *para* Auco y no *de* Auco.

## Por qué

Publicar con el nombre o la marca de un tercero confunde a quien lo instala sobre quién responde por el código. En un SDK que maneja llaves y firmas, eso es un problema de seguridad, no solo de marca.

## Consecuencias

- Si Auco adopta la v2, se migra a su scope y el nombre comunitario queda como alias deprecado.
- **Reversible y barato** mientras no se haya publicado nada.
