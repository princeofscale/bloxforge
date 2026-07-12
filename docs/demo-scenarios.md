# BloxForge Demo Scenarios

These scenarios showcase the capabilities of BloxForge when paired with an AI agent (like Claude Code or Cursor) to interact directly with Roblox Studio.

## Scenario 1: Building a Feature (Build)
**Goal:** Create a complete, functional in-game feature from scratch using natural language.

**User Prompt:**
> "I want to create a spinning coin collection system. Create a yellow coin Part in the Workspace. Then, write a script that makes the coin rotate continuously. When a player touches the coin, the coin should be destroyed, and a particle emitter should play a burst effect."

**What BloxForge Does:**
1. Uses `create_instance` to create a Part (Coin) and a ParticleEmitter.
2. Uses `update_properties` to color the Coin yellow and configure the emitter.
3. Uses `create_instance` to create a Server Script inside the Coin.
4. Uses `update_script_source` to write the Luau code handling the `Touched` event and the rotation loop.

## Scenario 2: Debugging an Existing Game (Debug)
**Goal:** Find and fix a runtime error in a complex game without manual searching.

**User Prompt:**
> "Players are complaining that the 'GiveWeapon' function is throwing an error about a missing 'Damage' property. Find the script that handles weapon giving and fix the error."

**What BloxForge Does:**
1. Uses `search_instances` or `read_all_scripts` to locate scripts containing the text "GiveWeapon".
2. Uses `read_script_source` to analyze the exact code.
3. Identifies that the script is trying to read `.Damage` from a Tool that doesn't have it.
4. Uses `update_script_source` or `apply_patch` to add a safety check (`if tool:FindFirstChild("Damage") then...`).
5. Uses `execute_luau` to run a quick test simulating the function call to verify the fix.

## Scenario 3: Safe Bulk Refactoring (Safety)
**Goal:** Rename a widespread variable or property safely across hundreds of scripts.

**User Prompt:**
> "We are renaming the 'Coins' currency to 'Gold'. Find every script in ServerScriptService that references 'player.leaderstats.Coins' and change it to 'player.leaderstats.Gold'."

**What BloxForge Does:**
1. Uses `read_all_scripts` to find all occurrences of the old variable.
2. Prepares patches for each script.
3. Demonstrates the **Safety** mechanisms: before applying massive changes, the agent can use `execute_luau` to dry-run the logic, or rely on BloxForge's error handling to revert if the patch is malformed.
4. Uses `update_script_source` to apply the exact targeted changes without breaking surrounding code.
