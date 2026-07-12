# Understand an Existing Game

Goal: Build a mental model of an unfamiliar Roblox place before making changes.

## 1. Gather context

```
get_scene_summary          → high-level overview (services, counts, top classes)
get_project_structure      → script tree with depths
get_file_tree              → full hierarchy of a subtree
```

## 2. Inspect key areas

```
scene_search query="door"  → find specific objects by name/class
get_script_source          → read individual scripts
grep_scripts pattern="..." → search across all scripts
```

## 3. Check runtime state

```
start_playtest             → launch a play session
get_runtime_logs           → check for errors at startup
diagnose_scripts           → structured error report (script:line)
stop_playtest              → end the session
```

## 4. When to stop

You have enough context when you can describe:
- The game's core loop
- Where player-facing scripts live
- What services are in use
- Any existing errors
