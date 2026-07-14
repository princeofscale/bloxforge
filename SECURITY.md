# Security

## What this project is

BloxForge is a local development tool. It runs entirely on your machine and communicates with Roblox Studio over a localhost HTTP bridge. No cloud service, no telemetry, no external network calls for core functionality.

## What this means

- The MCP server binds to `127.0.0.1` by default. Do not expose this port to the network; use an explicit host opt-in only when you understand the risk.
- Bridge callbacks use per-plugin bearer session tokens issued by `/ready`. `/ready` is the unauthenticated bootstrap endpoint; `/poll`, `/response`, `/ack`, `/stream`, and `/disconnect` require the issued token. Set `BLOXFORGE_SESSION_TOKEN` (or pass `--session-token`) to protect the MCP/proxy HTTP endpoints as well.
- CORS is not enabled on the bridge. If you deliberately bind beyond loopback, put an authenticated reverse proxy in front of it and restrict origins and the body limit (`MCP_HTTP_BODY_LIMIT`).
- The AI agent operates Roblox Studio with the permissions of the Studio plugin — same as any plugin from the Toolbox.
- `execute_luau` runs arbitrary Luau code in the plugin context. Only use this on places you own.
- The safety layer (dry-run, confirmation gating, backups, limits) is a defense-in-depth measure, not a guarantee.

## Reporting vulnerabilities

If you find a security issue, please **do not open a public issue**. Instead, report it privately to the maintainer through GitHub's security advisory system:

https://github.com/princeofscale/bloxforge/security/advisories/new

## Tool Profiles

BloxForge supports **Tool Profiles** to restrict what the AI agent can do. By default, the `core` profile provides a balance of read and safe write operations.

To restrict capabilities further, use the `--profile` flag when starting the server:
- `--profile core`: Standard permissions (read, write, execute scripts).
- `--profile inspector`: Read-only permissions. The agent can only read properties, search scripts, and list instances. Write/Execute capabilities are disabled.
- `--profile builder`: Allows building operations but restricts arbitrary script execution.
- `--profile tester`: Allows runtime environment interactions, script execution, and scene reads, but disables pure asset building.
- `--profile full`: Loads all available tool domains.

Using restrictive profiles minimizes the risk of accidental destructive actions or unwanted code execution.

## Best practices

1. Use `--profile inspector` for browsing or debugging — it has no write capability.
2. Dry-run before confirming mutations when possible.
3. Keep Roblox Studio and this project updated.
4. Only connect to places you own.
5. Review what the AI proposes before confirming destructive steps.
6. Commit your Roblox Studio place to version control or save backups frequently.
