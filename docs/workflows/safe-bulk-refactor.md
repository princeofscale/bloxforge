# Safe Bulk Refactor

Goal: Rename, restructure, or migrate game objects safely at scale.

## 1. Survey the scope

```
search_objects query="Part" → find all objects matching criteria
grep_scripts pattern="old_name" → find script references
```

## 2. Plan with dry-run

```
apply_mutation_plan dryRun=true → preview all changes
find_and_replace dryRun=true   → preview script text replacements
```

Review the dry-run output. Confirm the scope is correct.

## 3. Apply

```
apply_mutation_plan confirm=true → apply structural changes
find_and_replace                 → apply script replacements
mass_set_property                → batch property updates
```

## 4. Verify

```
get_changes_since          → review what changed since baseline
start_playtest             → test the refactored game
diagnose_scripts           → check for broken references
stop_playtest
```

## 5. Recovery

```
get_operation_history      → list all operations
restore_script_backup      → revert scripts
```

## When to stop and ask

- Dry-run shows more changes than expected
- Changes affect protected services (ServerScriptService, etc.)
- Script references span multiple systems
