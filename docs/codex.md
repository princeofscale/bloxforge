# Codex CLI + Roblox Studio MCP

[Codex CLI](https://github.com/openai/codex) is OpenAI's terminal-native AI coding agent. It supports MCP servers natively.

## Setup

```bash
codex mcp add robloxstudio -- npx -y @princeofscale/robloxstudio-mcp@latest --auto-install-plugin
```

## Tips

- Codex works well with the safe mutation workflow: inspect → dry-run → confirm.
- Use `scene_search` for "where is X" questions — Codex will find the right instance without tree dumps.
- For live playtest debugging, Codex can `start_playtest`, sample state, read logs, and fix issues in one session.
