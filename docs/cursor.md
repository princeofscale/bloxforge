# Cursor + Roblox Studio MCP

[Cursor](https://cursor.com) is an AI-first IDE with native MCP support.

## Setup

Add this to your project's `.cursor/mcp.json`:

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

Then restart Cursor. The Roblox Studio tools appear in Cursor's MCP tool list.

## Tips

- Cursor's agent mode works well with multi-step Roblox workflows.
- Use `tool_catalog_search` to discover the right tool without browsing the full list.
- The `ROBLOX_MCP_LAZY_TOOLS=1` env var reduces the initial tool list, which helps Cursor load faster.
