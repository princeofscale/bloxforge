# Cursor + BloxForge

[Cursor](https://cursor.com) is an AI-first IDE with native MCP support.

## Setup

Add this to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "robloxstudio": {
      "command": "npx",
      "args": ["-y", "@princeofscale/bloxforge@latest", "--auto-install-plugin"]
    }
  }
}
```

Then restart Cursor. The Roblox Studio tools appear in Cursor's MCP tool list.

## Tips

- Cursor's agent mode works well with multi-step Roblox workflows.
- Use `tool_catalog_search` when you want a compact way to find the right tool.
- Lazy tool loading is the default: use `load_toolset` for the domain you need when
  Cursor has not loaded a tool schema yet. Set `ROBLOX_MCP_LAZY_TOOLS=0` only if
  you want the full schema list advertised upfront.
