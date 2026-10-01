# packages/embed

`createSession(options)`: owns one Auco iframe, its `message` listener and its lifecycle, on top of `@lob26/auco-protocol` (bundled into `dist`, not imported at runtime). `compat` (phase 1) and the Custom Elements (phase 2) stand on it, so its invariants are their invariants.

## Invariants

- **Every frame message is filtered by `event.origin === origin` and `event.source === iframe.contentWindow`** (audit 1.1, decision 0001). Never loosen either check; two sessions on the same origin must not hear each other.
- **One terminal path.** `close` (unless `PENDING`), `finish`, `back`, `destroy()`, the `signal` and the handshake timeout all go through `end()` in `session.ts` (audit 1.6). Terminal states are final; a new way to end a session calls `end()`, it does not remove the listener itself.
- **No unhandled rejection, ever.** Every internal promise is caught; `done` carries a no-op `catch`. A failure is an `error` event with an `AucoError` subclass, plus a `done` rejection only when the session becomes `failed`.
- **Options are validated before the DOM is touched**: a bad option throws synchronously and leaves the container and an adopted iframe untouched.
- **An adopted iframe is touched only through `src`**: set to the frame URL, then `about:blank` on destroy.
- **SSR-safe import:** no `window`, `document` or `location` at module scope. No dependencies, no `innerHTML`.
- **Size:** protocol + embed ≤ 3 KB gzip (root `size-limit`). If a change goes over, cut code, not features.

## Check

```bash
pnpm -C packages/embed typecheck && pnpm -C packages/embed build
pnpm run size
pnpm exec biome ci packages/embed
```
