// Cross-DM stop_playtest signaling via plugin:SetSetting.
//
// `plugin:SetSetting` / `plugin:GetSetting` is a per-plugin persistent store
// that's shared across every DataModel the plugin runs in (edit, play-server,
// play-clients). We use it as a one-bit flag for "please call EndTest in the
// play-server DM":
//
//   * The edit DM's stopPlaytest handler writes the flag (requestStop).
//   * A monitor loop running inside the play-server DM polls the flag at 1Hz
//     and calls StudioTestService:EndTest when it flips true, then resets it.
//   * The edit DM then waits up to ~2.5s for the flag to be reset, which
//     tells us a play-server actually consumed the request (no false-positive
//     success when nothing was running).
//
// Why this is simpler than the previous edit-proxy registration:
//   * Doesn't depend on the MCP server tracking peer roles at all.
//   * Survives MCP server restarts: monitor loop is local to the play-server
//     plugin lifetime, not to any HTTP/registration state.
//   * No need for cross-DM LogService.MessageOut reflection (which we verified
//     does not work edit -> play-server anyway).
//
// Pattern mirrors the official Roblox Studio MCP
// (Roblox/studio-rust-mcp-server, plugin/src/Utils/GameStopUtil.luau).

const StudioTestService = game.GetService("StudioTestService");

const SETTING_KEY = "MCP_STOP_PLAY_SIGNAL";
const POLL_INTERVAL_SEC = 1;
const WAIT_FOR_CONSUMPTION_TIMEOUT_SEC = 2.5;
const WAIT_POLL_SEC = 0.1;

let pluginRef: Plugin | undefined;

function init(p: Plugin): void {
	pluginRef = p;
}

function startMonitor(): void {
	if (!pluginRef) {
		warn("[MCP] StopPlayMonitor.startMonitor called before init; skipping");
		return;
	}
	// Clear any stale value left from a prior session. If a real stop request
	// is in-flight when this runs, the requesting edit DM will set it again
	// within its 2.5s wait window.
	pcall(() => pluginRef!.SetSetting(SETTING_KEY, false));
	task.spawn(() => {
		while (true) {
			const [okGet, val] = pcall(() => pluginRef!.GetSetting(SETTING_KEY));
			if (okGet && val === true) {
				pcall(() => pluginRef!.SetSetting(SETTING_KEY, false));
				pcall(() => StudioTestService.EndTest("stopped_by_mcp"));
			}
			task.wait(POLL_INTERVAL_SEC);
		}
	});
}

function requestStop(): boolean {
	if (!pluginRef) return false;
	const [ok] = pcall(() => pluginRef!.SetSetting(SETTING_KEY, true));
	return ok;
}

function waitForConsumption(): boolean {
	if (!pluginRef) return false;
	const start = tick();
	while (tick() - start < WAIT_FOR_CONSUMPTION_TIMEOUT_SEC) {
		const [okGet, val] = pcall(() => pluginRef!.GetSetting(SETTING_KEY));
		if (okGet && val !== true) return true;
		task.wait(WAIT_POLL_SEC);
	}
	return false;
}

function clearPending(): void {
	if (!pluginRef) return;
	pcall(() => pluginRef!.SetSetting(SETTING_KEY, false));
}

export = {
	init,
	startMonitor,
	requestStop,
	waitForConsumption,
	clearPending,
};
