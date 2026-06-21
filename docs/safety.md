# Safety

This MCP server gives an AI agent the ability to read and write your Roblox Studio place. Safety is built into the tooling by design — not as an afterthought.

## What's protected

### Confirmation gating

The following operations require `confirm: true` before they execute:

- Deleting protected services (Workspace, ServerScriptService, Terrain, Lighting, etc.)
- Large bulk mutations (creating many objects at once)
- Terrain clearing
- Luau code matching destructive patterns (`ClearAllChildren`, `:Destroy`, DataStore writes, `os.*`)

The agent is told it needs confirmation. If you trust the operation, pass `confirm: true`.

### Script backups

Every `set_script_source` call automatically backs up the previous source. View and restore with:

- `list_script_backups` — see what's available
- `restore_script_backup` — restore a specific script to its pre-overwrite state

### Dry-run on every mutation

All significant mutation tools accept `dryRun: true`. The tool returns a preview of what would change without actually applying anything. The agent can present this diff before you commit.

### Operation history

`get_operation_history` returns recent destructive operations with timestamps. Undo/redo are also available through `undo` and `redo` tool calls.

### Hard limits

Even with `confirm: true`, these limits apply:

| Limit | Value |
|---|---|
| Objects per bulk create | Configurable (default 100) |
| Script size | Configurable |
| Terrain volume | Configurable |
| Device matrix entries | 6 max |
| Inline image size | ~6 MB |

## What's NOT protected

This system does not:

- Sandbox Luau execution. `execute_luau` runs with the plugin's permissions — the same as any plugin you install from the Toolbox. Only connect this to places you own.
- Encrypt the local bridge. The HTTP bridge runs on localhost only. Do not expose port 58741 to the network.
- Prevent all mistakes. The safety layer is a speed bump, not a guarantee. Review what the AI proposes before confirming destructive steps.

## Best practices

1. **Use the inspector edition** (`-inspector`) for browsing and code review — it has no write tools at all.
2. **Dry-run before you confirm.** Let the agent preview mutations.
3. **Review script diffs** before applying `set_script_source`.
4. **Keep backups** of your place file (Roblox Studio auto-saves `.rbxl` files).
5. **Only connect to places you own.** Do not use this on shared or production places without understanding the risks.

## The inspector edition

The `@princeofscale/robloxstudio-mcp-inspector` package is the same MCP server with all write tools removed. No mutations, no script edits, no asset creation — only inspection, search, and diagnostics.

```bash
claude mcp add robloxstudio-inspector -- npx -y @princeofscale/robloxstudio-mcp-inspector@latest --auto-install-plugin
```

Use this for code review, debugging, and exploration when you want zero mutation risk.
