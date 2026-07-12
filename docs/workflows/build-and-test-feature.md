# Build and Test a Feature

Goal: Implement a new feature, test it in play mode, iterate until it works.

## 1. Gather context

```
get_scene_summary          → understand current state
scene_search               → find where to add the feature
get_script_source          → read related scripts
```

## 2. Dry-run first

```
apply_mutation_plan dryRun=true   → preview structural changes
mass_create_objects dryRun=true   → preview object creation
```

## 3. Apply changes

```
apply_mutation_plan confirm=true  → apply structural changes
set_script_source                 → write new scripts
create_object                     → create individual objects
```

## 4. Test

```
start_playtest             → launch play mode
get_runtime_logs           → check for errors
diagnose_scripts           → structured error report
playtest_sample_state      → sample game state
run_gameplay_assertions    → verify behavior
stop_playtest              → end the session
```

## 5. Iterate

If errors are found:
1. Read the error details from `diagnose_scripts`
2. Fix the script with `edit_script_lines` or `set_script_source`
3. Re-test

## 6. Recovery

```
restore_script_backup      → revert a script to its pre-edit state
get_operation_history      → review what was changed
```
