import type { ToolDefinition } from '../definitions.js';

export const RUNTIME_TOOL_DEFINITIONS: ToolDefinition[] = [
  // === Playtest ===
  {
    name: 'solo_playtest',
    category: 'write',
    description: 'Compatibility wrapper for start_playtest/stop_playtest/status. Use action="start" with mode="play" or "run", action="stop" to stop, or action="status" to inspect runtime roles.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'status'], description: 'Lifecycle action.' },
        mode: { type: 'string', enum: ['play', 'run'], description: 'Required for action="start".' },
        timeout: { type: 'number', description: 'Max seconds to wait.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'multiplayer_playtest',
    category: 'write',
    description: 'Compatibility wrapper for multiplayer_test_* tools. Supports action="start", "status", "add_players", "leave_client", and "end".',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'add_players', 'leave_client', 'end'], description: 'Lifecycle action.' },
        numPlayers: { type: 'number', description: 'Required for start/add_players.' },
        target: { type: 'string', description: 'Client target for leave_client.' },
        testArgs: { description: 'JSON-compatible test args for start.' },
        value: { description: 'Value passed to end.' },
        timeout: { type: 'number', description: 'Max seconds to wait.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'start_playtest',
    category: 'write',
    description: 'Start a simple single-player Studio playtest in play or run mode, waiting until a runtime peer registers with MCP. Read print/warn/error output with get_runtime_logs, then end with stop_playtest. For multi-client testing use multiplayer_test_start instead.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['play', 'run'],
          description: 'Play mode'
        },
        numPlayers: {
          type: 'number',
          description: 'Deprecated and rejected. Use multiplayer_test_start for multi-client testing.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['mode']
    }
  },
  {
    name: 'stop_playtest',
    category: 'write',
    description: 'Stop playtest and wait for runtime peers to disconnect.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'set_network_profile',
    category: 'write',
    description: 'Apply simulated network conditions to active playtest client peers via NetworkSettings in plugin context. Requires a running playtest and targets only client peers: pass target="client-1", "client-2", etc., or target="all-clients". Presets: great = 30ms total latency (15ms in / 15ms out), 0ms jitter, 0% packet loss; good = 100ms total latency (50ms in / 50ms out), 10ms jitter, 0% packet loss; poor = 300ms (150ms in / 150ms out), 100ms jitter, 0.5% packet loss. profile="custom" applies only the numeric overrides provided; packet loss values above Roblox\'s 0.5% engine limit are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          enum: ['great', 'good', 'poor', 'custom'],
          description: 'Network condition preset. Presets set all six simulation fields; custom requires overrides.'
        },
        target: {
          type: 'string',
          description: 'Client target: "client-1" (default), "client-2", etc., or "all-clients" to apply to every connected playtest client.'
        },
        overrides: {
          type: 'object',
          additionalProperties: false,
          properties: {
            InboundNetworkMinDelayMs: {
              type: 'number',
              minimum: 0,
              description: 'Server-to-client minimum latency in milliseconds.'
            },
            OutboundNetworkMinDelayMs: {
              type: 'number',
              minimum: 0,
              description: 'Client-to-server minimum latency in milliseconds.'
            },
            InboundNetworkJitterMs: {
              type: 'number',
              minimum: 0,
              description: 'Server-to-client latency jitter in milliseconds.'
            },
            OutboundNetworkJitterMs: {
              type: 'number',
              minimum: 0,
              description: 'Client-to-server latency jitter in milliseconds.'
            },
            InboundNetworkLossPercent: {
              type: 'number',
              minimum: 0,
              maximum: 0.5,
              description: 'Server-to-client packet loss percentage. Roblox engine limit is 0.5%; larger values are rejected.'
            },
            OutboundNetworkLossPercent: {
              type: 'number',
              minimum: 0,
              maximum: 0.5,
              description: 'Client-to-server packet loss percentage. Roblox engine limit is 0.5%; larger values are rejected.'
            }
          },
          description: 'Optional exact NetworkSettings property overrides. For preset profiles, overrides replace preset fields. For custom, only these properties are applied.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['profile']
    }
  },
  {
    name: 'get_simulation_state',
    category: 'read',
    description: 'Inspect current NetworkSettings and/or StudioDeviceSimulatorService state for edit and connected playtest clients only. Defaults to include="both" and target="edit-and-clients"; server peers are skipped. Use before diagnosing network or device-sensitive tests, especially because normal Play can write client simulator changes back to edit and StudioTestService clients can inherit stale device simulator state.',
    inputSchema: {
      type: 'object',
      properties: {
        include: {
          type: 'string',
          enum: ['network', 'deviceSimulator', 'both'],
          description: 'Simulation state to inspect: "network", "deviceSimulator", or "both" (default both).'
        },
        target: {
          type: 'string',
          description: 'Simulation target scope: "edit-and-clients" (default), "edit", "all-clients", or a specific "client-N". Server peers are never included.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'reset_simulation_state',
    category: 'write',
    description: 'Reset reachable simulation state to a clean baseline for deterministic tests. Defaults to target="edit-and-clients" and resets both network and device simulator state. Network reset sets all six simulated NetworkSettings fields to 0; device reset calls StopSimulationAsync(). Call before tests, after starting Play or multiplayer, before stopping, and again on edit after stopping.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Simulation target scope: "edit-and-clients" (default), "edit", "all-clients", or a specific "client-N". Server peers are skipped.'
        },
        network: {
          type: 'boolean',
          description: 'Reset simulated NetworkSettings fields to 0 (default true).'
        },
        deviceSimulator: {
          type: 'boolean',
          description: 'Stop Studio device simulation with StopSimulationAsync() (default true).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'get_device_simulator_state',
    category: 'read',
    description: 'Inspect StudioDeviceSimulatorService state and supported built-in device presets. Defaults to target="edit"; also supports a regular playtest client target such as "client-1". Server targets are not supported. When no simulated device is active, active-only fields are omitted and isSimulating=false.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Device simulator target: "edit" (default) or a regular playtest client like "client-1". Server targets are rejected.'
        },
        deviceId: {
          type: 'string',
          description: 'Optional built-in device preset ID to inspect with GetDeviceInfoAsync.'
        },
        includeDeviceList: {
          type: 'boolean',
          description: 'Include the built-in device preset list from GetDeviceListAsync (default true).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'set_device_simulator',
    category: 'write',
    description: 'Set or stop StudioDeviceSimulatorService using built-in device presets only. Defaults to target="edit"; supports "client-N" and "all-clients"; rejects server targets. Applies deviceId first, then orientation, resolution, pixelDensity, and scalingMode overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Device simulator target: "edit" (default), "client-1", "client-2", etc., or "all-clients".'
        },
        deviceId: {
          type: 'string',
          description: 'Built-in device preset ID from get_device_simulator_state.'
        },
        orientation: {
          type: 'string',
          description: 'ScreenOrientation enum name, e.g. "LandscapeRight", "LandscapeLeft", "Portrait", or a full Enum.ScreenOrientation.* string.'
        },
        resolution: {
          type: 'object',
          additionalProperties: false,
          properties: {
            width: {
              type: 'number',
              description: 'Viewport width in pixels.'
            },
            height: {
              type: 'number',
              description: 'Viewport height in pixels.'
            }
          },
          required: ['width', 'height'],
          description: 'Optional resolution override applied after the device preset.'
        },
        pixelDensity: {
          type: 'number',
          description: 'Optional positive pixel density override applied after the device preset.'
        },
        scalingMode: {
          type: 'string',
          description: 'DeviceSimulatorScalingMode enum name, e.g. "ScaleToPhysicalSize", or a full Enum.DeviceSimulatorScalingMode.* string.'
        },
        stopSimulation: {
          type: 'boolean',
          description: 'Stop device simulation. When true, do not pass other simulator setters.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'capture_device_matrix',
    category: 'write',
    description: 'Apply up to 6 ordered Studio device simulator settings, capture each viewport screenshot, and restore the previous simulator state by default when the prior state is default or a built-in preset. Custom device persistence is intentionally unsupported. Defaults to target="edit"; supports regular playtest client targets but not server or all-clients targets.',
    inputSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          maxItems: 6,
          description: 'Ordered device capture entries. Each entry may set a deviceId and optional simulator overrides before capture.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: {
                type: 'string',
                description: 'Optional label included in the screenshot metadata.'
              },
              deviceId: {
                type: 'string',
                description: 'Built-in device preset ID from get_device_simulator_state.'
              },
              orientation: {
                type: 'string',
                description: 'ScreenOrientation enum name or full Enum.ScreenOrientation.* string.'
              },
              resolution: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  width: {
                    type: 'number',
                    description: 'Viewport width in pixels.'
                  },
                  height: {
                    type: 'number',
                    description: 'Viewport height in pixels.'
                  }
                },
                required: ['width', 'height']
              },
              pixelDensity: {
                type: 'number',
                description: 'Optional positive pixel density override.'
              },
              scalingMode: {
                type: 'string',
                description: 'DeviceSimulatorScalingMode enum name or full Enum.DeviceSimulatorScalingMode.* string.'
              }
            }
          }
        },
        target: {
          type: 'string',
          description: 'Device simulator target: "edit" (default) or a regular playtest client such as "client-1". all-clients and server targets are rejected.'
        },
        format: {
          type: 'string',
          enum: ['jpeg', 'png'],
          description: 'Screenshot image format. "jpeg" (default) is compact; "png" is lossless but may exceed inline size limits.'
        },
        quality: {
          type: 'number',
          description: 'JPEG quality 1-100 (default 92). Ignored for png.'
        },
        settleSeconds: {
          type: 'number',
          description: 'Seconds to wait after applying each simulator entry before capturing (default 0.3).'
        },
        restoreAfter: {
          type: 'boolean',
          description: 'Restore the previous default or built-in preset simulator state after the matrix finishes (default true). Custom active devices are not preserved.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['entries']
    }
  },
  {
    name: 'multiplayer_test_start',
    category: 'write',
    description: 'Start a StudioTestService multiplayer test and wait for the server plus requested client peers to connect. Use this for multi-client runtime testing.',
    inputSchema: {
      type: 'object',
      properties: {
        numPlayers: {
          type: 'number',
          description: 'Number of client players to start (1-8).'
        },
        testArgs: {
          description: 'JSON-compatible table passed to StudioTestService:GetTestArgs() on server and clients.'
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to wait for server + clients to register (default 30).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['numPlayers']
    }
  },
  {
    name: 'multiplayer_test_state',
    category: 'read',
    description: 'Get the active multiplayer StudioTestService state for a place: phase, peers, players, original testArgs, result/error, and connected client roles.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: {
          type: 'string',
          description: 'Which connected Studio place to inspect. Required when multiple places are connected; omit when one. Use get_connected_instances to list available IDs.'
        }
      }
    }
  },
  {
    name: 'multiplayer_test_add_players',
    category: 'write',
    description: 'Add client players to a running StudioTestService multiplayer test and wait for the new clients to connect.',
    inputSchema: {
      type: 'object',
      properties: {
        numPlayers: {
          type: 'number',
          description: 'Number of additional client players to add (1-8).'
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to wait for new clients to register (default 30).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['numPlayers']
    }
  },
  {
    name: 'multiplayer_test_leave_client',
    category: 'write',
    description: 'Disconnect a specific client from a running StudioTestService multiplayer test, then wait for that client peer to leave.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Client target to leave: "client-1" (default), "client-2", etc.'
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to wait for the client peer to disconnect (default 30).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'multiplayer_test_end',
    category: 'write',
    description: 'End a running StudioTestService multiplayer test with an optional return value, then wait for all runtime peers to disconnect.',
    inputSchema: {
      type: 'object',
      properties: {
        value: {
          description: 'JSON-compatible value returned to the edit-side ExecuteMultiplayerTestAsync call.'
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to wait for runtime peers to disconnect (default 30).'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'get_runtime_logs',
    category: 'read',
    description: 'Read the in-memory log buffers captured by Studio plugin peers. Each buffer captures ~64 KB of recent LogService output; runtime peers seed from LogService:GetLogHistory() at plugin load so early startup logs emitted before the plugin finishes loading can still be returned, then continue capturing LogService.MessageOut entries. Oldest entries drop when over budget. Entries include capturedBy for the plugin buffer that observed the log. In ordinary Studio play/run sessions, LogService reflects logs across edit/server/client, so script-origin peer is not reliable and entries omit peer. In StudioTestService multiplayer sessions only, peer attribution is reliable and entries also include peer. target=all (default) merges buffers and dedups same-message-and-level entries captured within 2s across different buffers.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Capture buffer to read from: "edit", "server", "client-N", or "all" (default). "all" merges buffers and dedups cross-buffer reflections within a 2s window.'
        },
        since: {
          type: 'number',
          description: 'Return only entries with seq > since. Pass back the previous response\'s nextSince (single target) or perCaptureNextSince entry (target=all) for incremental polling.'
        },
        tail: {
          type: 'number',
          description: 'Return only the last N entries after since/filter is applied.'
        },
        filter: {
          type: 'string',
          description: 'Plain substring matched against each entry\'s message (no pattern semantics; literal text). Applied after since, before tail.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'capture_script_profiler',
    category: 'read',
    description: 'Capture one short ScriptProfilerService sample on a running server or client peer and return a compact CPU summary. Use this for Luau/script optimization, not render, physics, networking, or engine microprofiler lanes. Minimal flow: start or reproduce the workload, call capture_script_profiler with target="server" or a specific "client-N", inspect top_functions, patch the suspected hot path, then capture again with the same target/workload/duration_ms/frequency/filter/min_total_us to compare. top_functions is sorted by descending total_us after native/plugin/min/filter exclusions; each row includes rank plus function_index, the 1-based index into the raw Roblox Functions array. Function and node TotalDuration values follow Roblox\'s exported Script Profiler JSON format and are reported in microseconds as total_us. total_us is cumulative profiler TotalDuration during the capture; nested labels/functions can overlap, so do not sum rows as total CPU time. source is the runtime script path reported by Roblox and may need mapping back to editable source with search tools. If function names are too broad, add debug.profilebegin("Area:SpecificStep") / debug.profileend() around suspected code and pass filter="Area:" or another label prefix; matching custom labels appear in debug_labels and top_functions with their script source and no line number. The result echoes effective options in applied and omitted.filtered_out counts rows removed by filter. Keep captures short while actively triggering the behavior; duration_ms defaults to 1000 and is clamped to 100-15000. Pass output_path when you need the raw Roblox Script Profiler JSON for offline comparison or deeper analysis. This tool owns the start/stop/request profiler lifecycle for one capture and does not expose long-lived profiler sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          pattern: '^(server|client-[0-9]+)$',
          description: 'Runtime peer to profile: "server" (default) or "client-N". Use get_connected_instances to discover available runtime roles. target="edit" is invalid because ScriptProfiler captures running code.'
        },
        duration_ms: {
          type: 'number',
          default: 1000,
          minimum: 100,
          maximum: 15000,
          description: 'Sample duration in milliseconds. Defaults to 1000; clamped to 100-15000 so the Studio bridge does not hang on long captures.'
        },
        frequency: {
          type: 'number',
          default: 1000,
          minimum: 1,
          maximum: 10000,
          description: 'ScriptProfiler sampling frequency in samples per second (Hz). Defaults to 1000.'
        },
        max_functions: {
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of top_functions and debug_labels to return. Defaults to 20; clamped to 1-100.'
        },
        min_total_us: {
          type: 'number',
          default: 0,
          minimum: 0,
          description: 'Omit functions below this TotalDuration in microseconds after capture. Defaults to 0.'
        },
        filter: {
          type: 'string',
          description: 'Optional case-insensitive substring matched against function name and source before top_functions are returned. Useful for focusing on one module or debug.profilebegin label prefix.'
        },
        include_native: {
          type: 'boolean',
          description: 'Include native Roblox frames in top_functions. Defaults to false to keep optimization output focused on game Luau and debug labels.'
        },
        include_plugin: {
          type: 'boolean',
          description: 'Include plugin frames in top_functions. Defaults to false because the MCP capture implementation can otherwise add noise.'
        },
        output_path: {
          type: 'string',
          description: 'Optional local path where the MCP server writes the raw Script Profiler JSON. The tool result then includes output_path instead of inlining the raw JSON.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'breakpoints',
    category: 'write',
    description: 'Manage Studio debugger breakpoints through ScriptDebuggerService. Use this when the user asks to debug with Studio breakpoints. Prefer log breakpoints for agent debugging: pass log_message and let continue_execution default to true, reproduce the issue, then read get_runtime_logs filtered by "Breakpoint". Minimal flow: set a log breakpoint, run or trigger the behavior, call get_runtime_logs with filter="Breakpoint", then call action="clear" to remove MCP-managed breakpoints. Generated breakpoint logs are prefixed with "Breakpoint" plus script_path:line; Studio breakpoint errors also start with "Breakpoint", so this filter captures both successful breakpoint logs and breakpoint-related failures. Set breakpoints on target="edit" before starting a playtest when possible; for an already-running playtest target the runtime DataModel directly, such as "server" or "client-1". Do not set continue_execution=false unless the target DataModel already has a ScriptDebuggerService.OnStopped handler that returns Enum.DebuggerResumeType.Resume for breakpoint/non-exception stops; otherwise the playtest can get stuck and MCP can lose the server/client peers. Minimal OnStopped reference: local sds=game:GetService("ScriptDebuggerService"); sds.OnStopped=function(info) if info.Reason ~= Enum.ScriptStoppedReason.Exception then return Enum.DebuggerResumeType.Resume end print("EXCEPTION:", info.ExceptionText); return Enum.DebuggerResumeType.Resume end. MCP-managed breakpoints persist minimal script_path/line recovery data per place and target so action="list" and action="clear" can find tool-created edit/server/client breakpoints after MCP/plugin reloads. action="clear" removes only breakpoints created through this MCP tool by default; pass clear_all=true only when you intentionally want to clear every Studio breakpoint in the targeted DataModel, including user-created breakpoints. This tool only manages breakpoint lifecycle; it does not pause, resume, step, inspect variables, or install OnStopped callbacks. Requires Studio Debugger Luau API beta enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'remove', 'clear', 'list'],
          description: 'Breakpoint action to run. set/remove require script_path and line. clear removes MCP-managed breakpoints by default. list returns breakpoints created through this MCP tool in the targeted DataModel.'
        },
        clear_all: {
          type: 'boolean',
          description: 'Only applies to action="clear". Omit or set false to remove only MCP-managed breakpoints tracked by this tool. Set true to call ScriptDebuggerService:ClearBreakpoints() and clear every Studio breakpoint in the targeted DataModel, including user-created breakpoints.'
        },
        script_path: {
          type: 'string',
          description: 'Path to a LuaSourceContainer, for example game.ServerScriptService.Main. Required for set/remove.'
        },
        line: {
          type: 'number',
          description: '1-based line number for set/remove.'
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the breakpoint is enabled when set. Defaults to true.'
        },
        condition: {
          type: 'string',
          description: 'Optional Luau condition expression for set.'
        },
        log_message: {
          type: 'string',
          description: 'Optional Studio breakpoint log expression list for set, such as "\'health\', health". Literal text must be quoted as a Luau string. The tool prefixes this with "Breakpoint" and script_path:line. After reproducing, read get_runtime_logs with filter="Breakpoint" so breakpoint logs and Studio breakpoint errors are both visible.'
        },
        continue_execution: {
          type: 'boolean',
          description: 'Whether the breakpoint should log and continue without pausing. Defaults to true when log_message is provided; otherwise false. Only set false when you have first installed a ScriptDebuggerService.OnStopped handler on the same target that resumes breakpoint/non-exception stops with Enum.DebuggerResumeType.Resume; without that handler the playtest can get stuck and MCP can lose server/client peers.'
        },
        target: {
          type: 'string',
          description: 'Peer to target: "edit" (default), "server", or "client-N". Set edit breakpoints before playtests; target server/client-N for running play DataModels.'
        },
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      },
      required: ['action']
    }
  },

  // === Multi-Instance ===
  {
    name: 'get_connected_instances',
    category: 'read',
    description: 'List all connected plugin instances with their roles. Use during multi-client playtest to discover server and client instances for targeted commands.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // === Undo/Redo ===
  {
    name: 'undo',
    category: 'write',
    description: 'Undo the last change in Roblox Studio. Uses ChangeHistoryService to reverse the most recent operation.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  {
    name: 'redo',
    category: 'write',
    description: 'Redo the last undone change in Roblox Studio. Uses ChangeHistoryService to reapply the most recently undone operation.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: {
          type: 'string',
          description: 'Connected Studio place id. Required only when multiple places are open.'
        }
      }
    }
  },
  // === Async Luau jobs (avoids long-poll timeouts on heavy code) ===
  {
    name: 'execute_luau_async',
    category: 'write',
    description: 'Run heavy/long Luau without risking a connection timeout: returns a jobId immediately while the code runs in the background. Poll get_job_status until done, then get_job_result. Use this instead of execute_luau when the code may take more than ~10s (mass builds, big scene scans). Job state lives in the targeted DataModel — poll status/result with the SAME target. Shares the same execute_luau wrapper, so fresh_require(module) is available and the require-cache caveat applies identically.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Luau code to run. print()/warn() are captured; the return value is captured.' },
        target: { type: 'string', description: 'Instance target: "edit" (default), "server", "client-1", etc.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      },
      required: ['code']
    }
  },
  {
    name: 'get_job_status',
    category: 'read',
    description: 'Check an execute_luau_async job: returns status (running/done/error/cancelled), done flag, and elapsed seconds. Poll this until done, then call get_job_result. Use the same target the job was started on.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id returned by execute_luau_async.' },
        target: { type: 'string', description: 'Instance target the job runs on: "edit" (default), "server", "client-1", etc.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      },
      required: ['jobId']
    }
  },
  {
    name: 'get_job_result',
    category: 'read',
    description: 'Fetch the result of a finished execute_luau_async job (returnValue, output, success/error). Returns status="running" if not done yet — call get_job_status first. Use the same target the job was started on.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id returned by execute_luau_async.' },
        target: { type: 'string', description: 'Instance target the job runs on: "edit" (default), "server", "client-1", etc.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      },
      required: ['jobId']
    }
  },
  {
    name: 'cancel_job',
    category: 'write',
    description: 'Request cancellation of a running execute_luau_async job. Best-effort: Luau coroutines cannot be force-killed, so the code keeps running but its result is discarded and the job is marked cancelled.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id returned by execute_luau_async.' },
        target: { type: 'string', description: 'Instance target the job runs on: "edit" (default), "server", "client-1", etc.' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      },
      required: ['jobId']
    }
  },
  {
    name: 'playtest_sample_state',
    category: 'read',
    description: 'Sample LIVE runtime state during a playtest: players (position/health/team/tool/humanoid state), named world state held in ValueBase objects (round counters, flags, ids), currently-playing audio, and runtime/role flags. Use this to debug gameplay while a test runs — pair with start_playtest/get_runtime_logs. Defaults to target="server"; in edit mode the player/world domains come back empty. Domain-masked via `domains`. AUDIO NOTE: Sound.PlaybackLoudness is always 0 in the Edit DataModel (no active audio listener/render) even when IsPlaying=true — only IsLoaded/IsPlaying are meaningful in edit; judge actual audibility/timbre in a playtest.',
    inputSchema: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string', enum: ['players', 'world', 'audio', 'runtime'] },
          description: 'Which state domains to sample (default: all).'
        },
        target: {
          type: 'string',
          description: 'Instance target: "server" (default, the live playtest server), "client-1", or "edit".'
        },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      }
    }
  },
  {
    name: 'run_gameplay_assertions',
    category: 'read',
    description: 'Run a list of named boolean assertions against the DataModel and get a structured pass/fail per assertion plus an allPassed summary — the QA primitive to PROVE a fix rather than declare it. Each assertion has a name and a Luau boolean `expr` (e.g. "workspace:FindFirstChild(\'Boss\') ~= nil"). Pair with start_playtest + target="server" to assert live runtime state after reproducing an issue.',
    inputSchema: {
      type: 'object',
      properties: {
        assertions: {
          type: 'array',
          description: 'Named boolean checks.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Human-readable assertion name.' },
              expr: { type: 'string', description: 'Luau expression that should evaluate truthy.' }
            },
            required: ['name', 'expr']
          }
        },
        target: { type: 'string', description: 'Instance target: "edit" (default), "server", "client-1".' },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      },
      required: ['assertions']
    }
  },
  {
    name: 'run_playtest_episode',
    category: 'write',
    description: 'One-shot runtime episode: start a playtest, let it run briefly, then gather the evidence an agent needs to reason about behaviour — runtime logs (error/warning counts + entries), optional gameplay assertions, an optional live state sample — and stop the playtest, returning a single episode object with a pass/fail verdict. Collapses the start_playtest → (sample/assert/logs) → stop_playtest loop into one call so the agent can drive an edit→playtest→observe→assert→fix cycle without hand-orchestrating the lifecycle. Verdict is "fail" if any assertion fails or runtime errors are logged, "error" if the playtest never reaches a ready runtime.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['play', 'run'],
          description: 'Playtest mode (default "play").'
        },
        assertions: {
          type: 'array',
          description: 'Optional named boolean checks to evaluate live during the episode (same shape as run_gameplay_assertions).',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Human-readable assertion name.' },
              expr: { type: 'string', description: 'Luau expression that should evaluate truthy.' }
            },
            required: ['name', 'expr']
          }
        },
        sampleDomains: {
          type: 'array',
          description: 'Optional telemetry domains to sample once during the episode (e.g. "players", "world", "audio"). Omit to skip the state sample.',
          items: { type: 'string' }
        },
        durationS: {
          type: 'number',
          description: 'How long to let the game run before sampling/stopping, in seconds (default 3, max 30).'
        },
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      }
    }
  },
  {
    name: 'summarize_episode',
    category: 'read',
    description: 'Distill a stored playtest episode (from run_playtest_episode) into the few facts that matter — verdict, failed assertions, the top error lines, the scripts those errors implicate, and a suggested next step — without re-running it. Pass comparedToEpisodeId of an earlier (failing) episode to PROVE a fix: it reports fixed=true on a fail→pass transition. Episodes are also readable as resources at roblox://playtest/episode/{id}.',
    inputSchema: {
      type: 'object',
      properties: {
        episodeId: {
          type: 'string',
          description: 'The episodeId returned by run_playtest_episode.'
        },
        comparedToEpisodeId: {
          type: 'string',
          description: 'Optional earlier episodeId to diff against (e.g. the failing run before your fix) to prove fail→pass.'
        }
      },
      required: ['episodeId']
    }
  },
  {
    name: 'propose_next_action',
    category: 'read',
    description: 'Deterministically pick the single next step in the edit→playtest→observe→fix loop from the stored playtest episodes — no LLM turn spent on the obvious move. With no episodeId it reads the most recent episode (and locates the most recent earlier FAILING run, so a clean run after a failure is recognized as a fix to prove). Returns { action, done, tool, args, rationale, focus }: when the next step is mechanical it names the exact MCP call + args (e.g. run_playtest_episode, or summarize_episode with comparedToEpisodeId); when it needs a human/LLM edit it sets tool=null and names the implicated scripts/assertions in "focus". action is one of run_episode | fix_startup | fix_assertion | fix_script | prove_fix | done.',
    inputSchema: {
      type: 'object',
      properties: {
        episodeId: {
          type: 'string',
          description: 'Optional episodeId to reason about. Omit to use the most recent stored episode.'
        }
      }
    }
  },
  {
    name: 'get_reproduction_bundle',
    category: 'read',
    description: 'Capture a point-in-time reproduction/audit bundle in one call: connected Studio places, a world overview snapshot, the recent mutating-operation history, and the stored playtest episodes. Use it to answer "what state is this place in and how did it get here" — for handing off, auditing an agent run, or pairing with get_changes_since for before/after deltas. Also readable as a resource at roblox://repro/bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'Connected Studio place id. Required only when multiple places are open.' }
      }
    }
  },
  {
    name: 'manage_instance',
    category: 'write',
    description: 'Launch, close, inspect, and find revisions for Studio instances. Use action="launch" with source="baseplate" for a blank place, or source="local_file" with local_place_file for a local place; neither uses place_id. Use action="list_place_versions" with place_id to retrieve version numbers through Open Cloud asset versions, then action="launch" with source="place_revision", place_id, and place_version to open an older revision. action="close" can close an MCP-managed instance or an explicitly connected edit instance by instance_id. action="launch" source="published_place" opens the latest published place and is blocked if that place_id is already connected; source="place_revision" is allowed because Studio opens explicit past revisions as anonymous local copies. Requires ROBLOX_OPEN_CLOUD_API_KEY with asset:read for list_place_versions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['launch', 'close', 'status', 'list_place_versions'],
          description: 'Instance management action.'
        },
        source: {
          type: 'string',
          enum: ['baseplate', 'local_file', 'published_place', 'place_revision'],
          description: 'Required for action="launch". baseplate/local_file do not use place_id; published_place opens the latest place; place_revision opens a specific older version as an anonymous local copy.'
        },
        local_place_file: {
          type: 'string',
          description: 'Required for source="local_file". Path to a .rbxl/.rbxlx place file.'
        },
        place_id: {
          type: 'number',
          description: 'Only used for source="published_place", source="place_revision", and action="list_place_versions". Do not pass for source="baseplate" or source="local_file".'
        },
        place_version: {
          type: 'number',
          description: 'Required for source="place_revision". Use action="list_place_versions" to discover available version numbers.'
        },
        wait_for_connection: {
          type: 'boolean',
          description: 'For action="launch": wait until the MCP plugin connects and return instance_id (default true).'
        },
        timeout_ms: {
          type: 'number',
          description: 'For action="launch": max milliseconds to wait for plugin connection (default 120000).'
        },
        max_page_size: {
          type: 'number',
          description: 'For action="list_place_versions": number of versions to return, clamped to 1-50 (default 10).'
        },
        page_token: {
          type: 'string',
          description: 'For action="list_place_versions": pagination token returned by a prior call.'
        },
        instance_id: {
          type: 'string',
          description: 'For action="close" or action="status": Studio instance to inspect or close. close accepts MCP-managed instances and explicitly connected edit instances.'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'capture_micro_profiler',
    category: 'read',
    description: 'Capture one short Roblox MicroProfiler sample on a running server or client peer using LibMP and return a structured CPU-time attribution dataset. Use this when the performance question is "where is the frame time going?" across scripts, physics, render, network, jobs, scheduler, GC, and engine timers. The primary data is top_groups/top_timers sorted by inclusive_us, exclusive-sorted companion lists, top_threads, top_call_edges, frame_summary, and analysis_window/data_quality so an agent can tell whether a result is steady, spiky, thread-bound, wrapper-heavy, or truncated. For baseline comparison, first capture an empty baseplate/control with the same target/settings and summary_output_path, then capture the game with baseline_path pointing at that saved JSON; saved summaries include a compact comparison_index so baseline_comparison can compare full compact aggregates instead of only visible top rows. Pass baseline inline when the previous capture is already in context. Times are reported in microseconds by converting LibMP MicroProfiler nanosecond ticks; inclusive_us is cumulative nested timer time and can overlap across timers/threads, so do not sum rows as total frame time. *_per_s fields are normalized by analysis_window.analysis_duration_us, not requested duration_ms. pct_of_analyzed_wall can exceed 100 when work overlaps. focus can restrict to script, physics, render, network, or jobs. include_idle defaults false so Sleep/idle noise is omitted. max_events bounds iterator work; event_limit_hit and partial_reasons explain when rankings are useful but partial, so narrow focus/filter or raise max_events for deeper analysis. recommended_tools is intentionally brief; the main purpose is digestible attribution data, not an agent diagnosis.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          pattern: '^(server|client-[0-9]+)$',
          description: 'Runtime peer to profile: "server" (default) or "client-N". Use get_connected_instances to discover available runtime roles.'
        },
        duration_ms: {
          type: 'number',
          default: 1000,
          minimum: 100,
          maximum: 5000,
          description: 'MicroProfiler capture duration in milliseconds. Defaults to 1000; clamped to 100-5000 because decoded event streams are much larger than ScriptProfiler output.'
        },
        focus: {
          type: 'string',
          enum: ['all', 'script', 'physics', 'render', 'network', 'jobs'],
          default: 'all',
          description: 'Optional subsystem focus. Use "all" first for unknown bottlenecks; use a narrower focus after top_groups identifies the area.'
        },
        filter: {
          type: 'string',
          description: 'Optional case-insensitive substring matched against timer name and group after capture. Use to inspect a specific timer family such as Heartbeat, Simulation, $Script, or RbxTransport.'
        },
        max_timers: {
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of top_timers to return. Defaults to 20.'
        },
        max_groups: {
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of top_groups to return. Each group includes its own hot timers. Defaults to 20.'
        },
        max_timers_per_group: {
          type: 'number',
          default: 5,
          minimum: 0,
          maximum: 20,
          description: 'Maximum number of nested top_timers included inside each top_groups row. Defaults to 5; use 0 to omit nested timers.'
        },
        max_related_timers: {
          type: 'number',
          default: 3,
          minimum: 0,
          maximum: 10,
          description: 'Maximum per-row parent, child, and thread context entries. Defaults to 3; use 0 to omit per-row relationship context.'
        },
        min_total_us: {
          type: 'number',
          default: 0,
          minimum: 0,
          description: 'Omit timers below this inclusive_us threshold after idle/focus/filter processing. Defaults to 0.'
        },
        include_idle: {
          type: 'boolean',
          description: 'Include Sleep/idle timers. Defaults to false because idle time usually hides actionable engine work.'
        },
        include_gpu: {
          type: 'boolean',
          description: 'Include GPU thread events when LibMP exposes them. Defaults to false to keep CPU diagnosis focused.'
        },
        max_events: {
          type: 'number',
          default: 250000,
          minimum: 10000,
          maximum: 1000000,
          description: 'Maximum LibMP log events to walk. Defaults to 250000; raise for deeper captures or lower to keep quick iterations snappy.'
        },
        frame_window: {
          type: 'number',
          default: 240,
          minimum: 1,
          maximum: 2000,
          description: 'Analyze only the last N MicroProfiler frames from the snapshot. Defaults to 240.'
        },
        output_path: {
          type: 'string',
          description: 'Optional local path where the MCP server writes the raw MicroProfiler snapshot bytes. The normal response stays summarized.'
        },
        summary_output_path: {
          type: 'string',
          description: 'Optional local path where the MCP server writes the summarized JSON response, including a compact comparison_index. Use this to save an empty-baseplate/control capture for later baseline_path comparison.'
        },
        baseline_path: {
          type: 'string',
          description: 'Optional local path to a prior capture_micro_profiler summarized JSON response. The tool adds baseline_comparison using current minus baseline, normalized by capture duration.'
        },
        baseline: {
          type: 'object',
          description: 'Optional inline prior capture_micro_profiler summarized response to compare against. Prefer baseline_path for large captures.'
        },
        baseline_label: {
          type: 'string',
          description: 'Label used for the baseline side of baseline_comparison, such as "empty_baseplate".'
        },
        current_label: {
          type: 'string',
          description: 'Label used for the current capture side of baseline_comparison, such as the game or scenario name.'
        },
        max_comparison_rows: {
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 100,
          description: 'Maximum delta rows returned per baseline_comparison section: groups, timers, threads, and call_edges. Defaults to 20.'
        },
        include_comparison_index: {
          type: 'boolean',
          description: 'Include the full compact comparison_index in the normal response. Defaults to false; summary_output_path still saves it for baseline comparison.'
        },
        instance_id: {
          type: 'string',
          description: 'Which connected Studio place to target. Required when multiple places are connected; omit when one. Use get_connected_instances to list available IDs.'
        }
      }
    }
  },
];
