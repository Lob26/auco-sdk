# packages/legacy — auco-sdk-integration 1.0.9, congelado

Este paquete es la 1.0.9 movida tal cual desde la raíz del repo. Existe para que
la suite de caracterización fije lo que la 1.x hace hoy (ver
`docs/decisions/0003-politica-de-compatibilidad.md`), no para evolucionarla.

## Invariantes

- **`src/` y `example/` solo aceptan formato de Biome.** Ningún arreglo de
  lógica, renombre ni limpieza, aunque el linter lo pida o la auditoría
  ([#1](https://github.com/Lob26/auco-sdk/issues/1)) lo marque como defecto: los
  defectos se corrigen en el paquete nuevo, y aquí se documentan con un
  `it.fails` en `test/`.
- **Si una regla de Biome marca código legado**, se apaga en `biome.jsonc` con
  un override acotado a la ruta que golpea y un comentario con el archivo, la
  línea y el id de la auditoría. Si un flag de `tsconfig.base.json` falla, se
  apaga solo ese flag en `tsconfig.json`, con el mismo tipo de comentario.
- **`"private": true` no se toca.** Este fork nunca publica el nombre de npm de
  upstream.
- **La API pública es solo `AucoSDK`**, igual que en el tarball 1.0.9. Los tipos
  (`Config`, …) no se exportan desde el entry point (auditoría 3.1); cambiar eso
  es trabajo de la v2.

## Comandos

```bash
pnpm --filter auco-sdk-integration build      # tsdown → dist/index.{mjs,cjs,d.mts,d.cts}
pnpm --filter auco-sdk-integration typecheck  # tsc --noEmit
pnpm --filter auco-sdk-integration test       # vitest run, happy-dom
```

`test` falla si no hay ningún `test/**/*.test.ts`, a propósito: una suite que
desaparece no puede pasar en verde.

Los nombres de `dist/` están fijados por `fixedExtension` en `tsdown.config.ts`
porque los leen `exports` en `package.json` y el `size-limit` de la raíz;
cambiarlos rompe ambos.
