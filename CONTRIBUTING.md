# Contributing

Thanks for your interest in contributing to BloxForge! Every contribution — code, docs, bug reports, feature ideas, or just using the project — helps make it better for everyone.

## Where to start

- **Bug reports:** Open a GitHub issue with OS, Node version, Studio version, AI client, `--doctor` output, and reproduction steps.
- **Feature ideas:** Open a GitHub issue describing the problem and your proposed solution.
- **Documentation:** The `docs/` directory and README always need proofreading, examples, and clarification.
- **Code:** Check [todo.md](todo.md) for current priorities, or pick a tool domain that interests you.

## Code contribution workflow

1. Fork the repo.
2. Create a feature branch (`git checkout -b feat/my-change`).
3. Make your changes.
4. Run `npm run typecheck && npm test && npm run build` to verify.
5. If adding a new tool, see "Adding a tool" below.
6. Push and open a pull request.

## Adding a tool

1. **Schema definition** — `packages/core/src/tools/definitions/<domain>.ts`
2. **Handler** — `packages/core/src/http-server.ts` → `TOOL_HANDLERS` map
3. **Implementation** — `packages/core/src/tools/index.ts` method (or extract to domain class)
4. **Plugin endpoint (optional)** — `studio-plugin/src/modules/handlers/*` + `Communication.ts` routeMap
5. **Test** — add to existing test file or create new
6. **Catalog** — `tools/tool-catalog.ts` → `DOMAIN_OVERRIDES` if name doesn't classify by prefix

Each tool needs:
- `instance_id` in its schema (unless Studio-agnostic)
- `instance_id` threaded in the handler
- Schema-parity invariant: definition and handler agree on all params

## Development setup

```bash
npm install
cd studio-plugin && npm install && cd ..
npm run build
npm run typecheck && npm test
```

## Code style

- TypeScript, strict mode
- `2-space` indentation
- Descriptive variable names over comments
- `async` methods with explicit parameter names (not destructured config objects)
- `instance_id` is always the last optional parameter
- Private helpers prefixed with `_`

## Asking questions

Open a [discussion](https://github.com/princeofscale/bloxforge/discussions) for questions, workflow ideas, or help getting started.
