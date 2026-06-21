# Claude Code + Roblox Studio MCP

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) is Anthropic's official agentic coding tool. It connects to MCP servers natively and is the primary supported client for this project.

## Setup

```bash
claude mcp add robloxstudio -- npx -y @princeofscale/robloxstudio-mcp@latest --auto-install-plugin
```

Then restart Claude Code and open a Roblox Studio place.

## Tips

- **Start cheap.** Ask for a scene summary first instead of dumping everything: _"What's in this place?"_
- **Compose workflows.** Claude is good at multi-step: _"Find the door system, read its scripts, and explain how it works."_
- **Use dry-run for edits.** Claude will naturally call `apply_mutation_plan` with `dryRun: true` before mutating.
- **Async for heavy work.** Generate-heavy tasks (terrain, full game templates) may take time — Claude handles async job polling transparently.

## Recommended settings

Place this in `~/.claude/settings.json` to auto-start the server:

```json
{
  "mcpServers": {
    "robloxstudio": {
      "command": "npx",
      "args": ["-y", "@princeofscale/robloxstudio-mcp@latest", "--auto-install-plugin"]
    }
  }
}
```

## Inspector mode for code review

```bash
claude mcp add robloxstudio-inspector -- npx -y @princeofscale/robloxstudio-mcp-inspector@latest --auto-install-plugin
```

Use the inspector edition when you only need to browse and review — no write risk.

## Troubleshooting

| Issue | Fix |
|---|---|
| Claude can't find Studio | The MCP server needs Studio running with a place open and **Allow HTTP Requests** enabled. |
| Tools return `PLUGIN_DISCONNECTED` | Restart Studio and ensure the plugin shows **Connected**. |
| Slow responses with large places | Use `get_scene_summary` (cheap) instead of `get_descendants` (expensive). |
