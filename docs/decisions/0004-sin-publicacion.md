# 0004 — Ningún paquete se publica; los nombres locales son `@lob26/auco-*`

- **Estado:** aceptada (2026-10-01). Precisa la [0002](./0002-nombre-del-paquete.md), no la reemplaza.
- **Contexto:** [hoja de ruta #3](https://github.com/Lob26/auco-sdk/issues/3), fase 1

## Decisión

- **Nada de este repo se publica en npm**, ni siquiera bajo un nombre comunitario. Todos los paquetes llevan `"private": true`.
- Los paquetes del workspace se llaman `@lob26/auco-<parte>` (`@lob26/auco-protocol`, `@lob26/auco-embed`, `@lob26/auco-compat`, …). El scope personal deja claro quién es el dueño. Los nombres existen solo para resolver imports dentro del monorepo.
- **Changesets sale del tooling:** sin publicación no hay versiones que coordinar.

## Consecuencias

- La fase 5 de la hoja de ruta cambia de "publicar la 2.0" a "proponer la 2.0 a Auco". Quien la consuma antes lo hace desde git o con un build propio.
- Si Auco adopta el proyecto, renombrar a su scope es un reemplazo mecánico de `@lob26/auco-` en imports y `package.json`.
- **Reversible:** publicar más adelante solo exige quitar `"private"` y volver a evaluar la 0002.
