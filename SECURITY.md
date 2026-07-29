# Security

## What this project is

BloxForge is a local development tool. It runs entirely on your machine and communicates with Roblox Studio over a localhost HTTP bridge. No cloud service, no telemetry, no external network calls for core functionality.

## What this means

- The MCP server binds to `127.0.0.1` by default. A non-loopback `--host` is rejected unless `BLOXFORGE_SESSION_TOKEN` is set.
- Bridge callbacks use per-plugin bearer session tokens issued by `/ready`. `/ready` is the unauthenticated bootstrap route; `/poll`, `/response`, `/ack`, `/reconcile`, `/stream`, and `/disconnect` require that plugin token.
- Server-client routes (`/proxy`, `/instances`, `/cancel`, request-status lookup, `/mcp`, and `/mcp/*`) require the configured server token. Local diagnostics (`/health`, `/status`, and `/dashboard*`) are public only in the zero-configuration loopback mode and are protected whenever server authentication is configured.
- Machine-control routes accept JSON only and reject browser `Origin` requests. CORS alone is not treated as CSRF protection. `MCP_CONTROL_BODY_LIMIT` controls small control bodies; `MCP_HTTP_BODY_LIMIT` controls large MCP and response payloads.
- The AI agent operates Roblox Studio with the permissions of the Studio plugin — same as any plugin from the Toolbox.
- `execute_luau` runs arbitrary Luau code in the plugin context. Only use this on places you own.
- The safety layer (dry-run, confirmation gating, backups, limits) is a defense-in-depth measure, not a guarantee.

## Reporting vulnerabilities

If you find a security issue, please **do not open a public issue**. Instead, report it privately to the maintainer through GitHub's security advisory system:

https://github.com/princeofscale/bloxforge/security/advisories/new

## Tool Profiles

BloxForge separates lazy schema discovery from authorization. Loading a toolset only changes schema visibility; it never grants a tool denied by the active profile or capability policy.

To restrict capabilities further, use the `--profile` flag when starting the server:
- `--profile core`: Standard permissions; only the initial schema set is small.
- `--profile inspector`: Read-only permissions. The agent can only read properties, search scripts, and list instances. Write/Execute capabilities are disabled.
- `--profile builder`: Allows building operations but restricts arbitrary script
  execution, including assertion expressions and assertion-bearing playtest episodes.
- `--profile tester`: Allows runtime environment interactions, script execution, and scene reads, but disables pure asset building.
- `--profile full`: Authorizes and preloads all available tool domains.

Invalid profile names fail startup. The dedicated inspector package also ships only read-category definitions, providing a second independent read-only boundary.

Prefer environment variables for secrets. The compatibility flags
`--session-token`, `--open-cloud-key`, and `--pollinations-key` remain
available but warn because command-line values may be visible in shell history
and process listings.

Quality-tool file arguments are canonicalized inside `BLOXFORGE_PROJECT_ROOT`;
escaping symlinks, traversal, absolute paths outside the root, and option-shaped
file names are rejected before an external command starts.

## Best practices

1. Use `--profile inspector` for browsing or debugging — it has no write capability.
2. Dry-run before confirming mutations when possible.
3. Keep Roblox Studio and this project updated.
4. Only connect to places you own.
5. Review what the AI proposes before confirming destructive steps.
6. Commit your Roblox Studio place to version control or save backups frequently.
