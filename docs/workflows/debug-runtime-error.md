# Debug a Runtime Error

Goal: Find, diagnose, and fix a runtime error in a Roblox game.

## 1. Reproduce the error

```
start_playtest             → launch the game
get_runtime_logs           → capture output log
```

## 2. Diagnose

```
diagnose_scripts           → structured errors with script:line
get_script_source          → read the affected script
grep_scripts pattern="..." → search for related code
```

## 3. Dry-run the fix

```
edit_script_lines          → preview line edits
```

## 4. Apply the fix

```
edit_script_lines / set_script_source → apply the fix
```

## 5. Verify

```
start_playtest             → re-launch
get_runtime_logs           → confirm error is gone
diagnose_scripts           → verify clean output
stop_playtest
```

## 6. Recovery

```
restore_script_backup      → revert if the fix made things worse
```

## When to stop and ask

- Error involves engine internals or C++ crashes
- Error only appears on specific devices/platforms
- Multiple interrelated errors across many scripts
