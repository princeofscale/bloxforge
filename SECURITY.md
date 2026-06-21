# Security

## What this project is

Roblox Studio MCP is a local development tool. It runs entirely on your machine and communicates with Roblox Studio over a localhost HTTP bridge. No cloud service, no telemetry, no external network calls for core functionality.

## What this means

- The MCP server and Studio plugin communicate over `localhost:58741`. Do not expose this port to the network.
- The AI agent operates Roblox Studio with the permissions of the Studio plugin — same as any plugin from the Toolbox.
- `execute_luau` runs arbitrary Luau code in the plugin context. Only use this on places you own.
- The safety layer (dry-run, confirmation gating, backups, limits) is a defense-in-depth measure, not a guarantee.

## Reporting vulnerabilities

If you find a security issue, please **do not open a public issue**. Instead, report it privately to the maintainer through GitHub's security advisory system:

https://github.com/princeofscale/robloxstudio-mcp/security/advisories/new

## Best practices

1. Use the inspector edition (`-inspector`) for browsing — it has no write capability.
2. Dry-run before confirming mutations.
3. Keep Roblox Studio and this project updated.
4. Only connect to places you own.
5. Review what the AI proposes before confirming destructive steps.
