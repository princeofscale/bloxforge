# Audit Before Release

Goal: Pre-release quality checklist for a Roblox game.

## 1. Structural audit

```
get_scene_summary          → overview of all services
get_project_structure scriptsOnly=true → all scripts
scene_search query="TODO"  → find leftover TODOs
```

## 2. Script health

```
grep_scripts pattern="print" → find debug prints
grep_scripts pattern="warn"  → find debug warnings
diagnose_scripts             → check for errors
```

## 3. Runtime test

```
start_playtest
run_gameplay_assertions      → verify core mechanics
playtest_sample_state        → check game state
get_runtime_logs             → review all output
stop_playtest
```

## 4. Asset check

```
get_reproduction_bundle      → full audit snapshot
```

## 5. Documentation

Review and update:
- Game description
- Script comments
- ModuleScript API documentation

## When to stop and ask

- Performance profiling results need human interpretation
- Multiplayer edge cases require manual testing
- Marketplace compliance requires human review
