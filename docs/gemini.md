# Gemini CLI + Roblox Studio MCP

[Gemini CLI](https://google-gemini.github.io/gemini-cli/) is Google's AI coding assistant. It supports MCP servers.

## Setup

```bash
gemini mcp add robloxstudio npx --trust -- -y @princeofscale/robloxstudio-mcp@latest --auto-install-plugin
```

The `--trust` flag tells Gemini CLI to trust the `npx` command.

## Tips

- Gemini CLI works with the full tool set — inspection, mutation, templates, and debugging are all available.
- The safety layer works transparently: Gemini will ask for confirmation on destructive operations.
- Dashboard at `http://localhost:58741/dashboard` works alongside Gemini CLI.
