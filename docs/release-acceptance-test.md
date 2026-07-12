# BloxForge Release Acceptance Test

This checklist outlines the manual verification steps that must be performed in Roblox Studio before publishing a new release of BloxForge to ensure plugin and server interoperability.

## Pre-requisites
1. Build the local project: `npm run build:all`
2. Run the newly built server: `npm start`
3. Install the newly built plugin: `npm run start -- --install-plugin`
4. Open Roblox Studio with a blank baseplate.

## 1. Connection & Handshake
- [ ] Ensure "Allow HTTP Requests" is enabled in Game Settings -> Security.
- [ ] Click "Play" or "Run" in Studio.
- [ ] Verify the BloxForge plugin widget appears and shows a "Connected" status.
- [ ] Check the server terminal output for a successful handshake (e.g., matching protocol versions).
- [ ] Run `npx @princeofscale/bloxforge verify` and ensure all checks are green (No plugin version warnings).

## 2. Basic Tool Execution
- [ ] Open an MCP client (e.g., Claude Code or Cursor).
- [ ] Request: "List the children of Workspace".
- [ ] Verify the client successfully uses the `list_children` tool and returns the expected instances (Camera, Terrain, etc.).

## 3. Instance Manipulation
- [ ] Request: "Create a red Part named 'TestPart' in Workspace".
- [ ] Verify the part appears in the Explorer.
- [ ] Request: "Change the material of 'TestPart' to Neon".
- [ ] Verify the material updates in Studio.
- [ ] Request: "Delete 'TestPart'".
- [ ] Verify the part is removed.

## 4. Scripting & Execution
- [ ] Request: "Create a Script in ServerScriptService that prints 'Hello World'".
- [ ] Verify the script is created with the correct source.
- [ ] Request: "Execute a Luau script that prints 5+5".
- [ ] Verify the server terminal or client receives the `10` output.

## 5. Error Handling
- [ ] Stop the MCP server (`Ctrl+C`).
- [ ] Verify the plugin widget gracefully shows "Disconnected".
- [ ] Start the MCP server again.
- [ ] Verify the plugin automatically reconnects.
- [ ] Request an invalid operation (e.g., "Read the properties of an instance that doesn't exist").
- [ ] Verify the client receives a clean, actionable error message instead of an internal crash.

If all checks pass, the release is deemed stable for publication.
