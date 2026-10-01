# auco-sdk (fork comunitario de `auco-ai/sdk-integration-library`)

Reescritura v2 de un SDK agnóstico de framework para embeber los flujos de Auco. El plan está en la hoja de ruta [#3](https://github.com/Lob26/auco-sdk/issues/3), la arquitectura en la RFC [#2](https://github.com/Lob26/auco-sdk/issues/2) y la evidencia en la auditoría [#1](https://github.com/Lob26/auco-sdk/issues/1). Antes de proponer un cambio de forma, lee las decisiones en `docs/decisions/`: lo que ya está decidido no se vuelve a discutir en un PR.

## Mapa

| Ruta | Qué es | Regla que más se rompe |
|------|--------|------------------------|
| `packages/protocol/` | Contrato del protocolo `postMessage` de la 1.0.9: `PROTOCOL.md` + fixtures | Describe la 1.0.9, no el código deseado. Ver su `AGENTS.md` |
| `packages/legacy/` | La 1.0.9 congelada + su suite de caracterización | Sus defectos no se arreglan aquí. Ver su `AGENTS.md` |
| `docs/decisions/` | Registros de decisión numerados | Una decisión nueva va en un archivo nuevo; las viejas no se reescriben |
| `scripts/` | Toda la lógica de CI, en bash | Ver "CI" abajo |

## Verificar

```bash
bash scripts/ci.sh              # el pipeline completo, idéntico a GitHub Actions
bash scripts/ci.sh lint test    # solo esos pasos
```

Pasos, en orden: `install fixtures shell lint typecheck build test size`. Si el script está en verde, CI está en verde. No declares un cambio terminado sin correrlo y pegar el resultado.

- **pnpm** (lo fija `packageManager`), nunca npm ni yarn. Node `^22.19 || ^24.11 || >=26`.
- **TypeScript 7** (el compilador nativo). tsdown avisa en el build que su API es experimental: es esperado, y los `.d.ts` salen idénticos a los de TS 6.
- `biome format --write` y `biome check --write` se acotan a tus archivos, nunca a `.`.

## CI

- **La lógica de CI vive en `scripts/*.sh`**: bash con `set -euo pipefail` y limpio para shellcheck. El YAML de `.github/workflows/` solo prepara el runner y llama `bash scripts/ci.sh`.
- Si un paso no se puede escribir razonablemente en bash, se usa un `.mjs`, y el porqué va en un comentario. Nada de Python ni de TypeScript ejecutado.
- Un paso nuevo se agrega a `STEPS` en `scripts/ci.sh`, no como un step suelto en el YAML.

## Seguridad

- **Una llave `prk_` nunca va en código de cliente, fixtures, tests ni ejemplos.** La doc de Auco la pone en el navegador para `upload` (auditoría 6.1), y este repo no repite ese patrón.
- Las fixtures y los tests usan solo valores falsos: llaves `puk_` + 32 ceros, emails `@example.com` y documentos `DOC0000000AA`.
- Nada se publica bajo el scope `@auco` ni con la marca de Auco como si fuera oficial (decisión 0002). `packages/legacy` es `"private": true` y así se queda.

## Idioma y commits

- Docs, mensajes de commit, títulos y cuerpos de PR: español neutro latinoamericano (es-CO), **sin voseo**. Identificadores, logs y `AGENTS.md` de paquetes de infraestructura: inglés.
- Conventional Commits con scope y asunto en español: `feat(protocol): …`, `chore(ci): …`.
- Un commit no lleva enlaces a sesiones de agentes.
