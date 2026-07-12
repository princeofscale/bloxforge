# Create and Test UI

Goal: Build a UI from agent prompts and verify it works.

## 1. Gather context

```
get_instance_children path="game.StarterGui" → existing UI
get_scene_summary → overall structure
```

## 2. Build the UI

```
ui_create_screen_gui       → top-level container
ui_create_frame            → layout frame
ui_create_text_label       → static text
ui_create_text_button      → interactive buttons
ui_create_image_label      → images
ui_apply_layout            → UIListLayout, UIGridLayout, etc.
ui_make_mobile_friendly    → responsive scaling
```

## 3. Add behavior scripts

```
set_script_source          → button handlers, animations
```

## 4. Test

```
start_playtest             → see the UI in-game
capture_screenshot         → visual check
get_runtime_logs           → check for UI script errors
stop_playtest
```

## 5. Iterate

Adjust properties with `set_property` or `set_properties` until the UI looks right.

## When to stop and ask

- Complex animations or tweening logic
- Platform-specific layout requirements
- Accessibility considerations
