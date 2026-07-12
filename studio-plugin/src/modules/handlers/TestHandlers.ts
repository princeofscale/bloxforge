import { HttpService, LogService, Players, RunService } from "@rbxts/services";
import StopPlayMonitor from "../StopPlayMonitor";

interface StudioTestServiceMultiplayer extends StudioTestService {
	ExecuteMultiplayerTestAsync(numPlayers: number, testArgs: unknown): unknown;
	AddPlayers(numPlayers: number): void;
	CanLeaveTest(): boolean;
	LeaveTest(): void;
	EditModeActive: boolean;
}

const StudioTestService = game.GetService("StudioTestService") as StudioTestServiceMultiplayer;
const ServerScriptService = game.GetService("ServerScriptService");
const ScriptEditorService = game.GetService("ScriptEditorService");

// NAV_SIGNAL flows from the edit DM to the play-server DM via the injected
// __MCP_CommandListener Script + LogService.MessageOut. Stop signaling moved
// off this path entirely (see StopPlayMonitor) because cross-DM MessageOut
// reflection from edit -> play-server does not work in practice.
const NAV_SIGNAL = "__MCP_NAV__";
const NAV_RESULT = "__MCP_NAV_RESULT__";

let testRunning = false;
let navLogConnection: RBXScriptConnection | undefined;
let stopListenerScript: Script | undefined;
let navResultCallback: ((json: string) => void) | undefined;

type MultiplayerPhase = "idle" | "starting" | "running" | "completed" | "failed";

interface MultiplayerSessionState {
	phase: MultiplayerPhase;
	testId?: string;
	numPlayers?: number;
	testArgs?: unknown;
	startedAt?: number;
	completedAt?: number;
	ok?: boolean;
	result?: unknown;
	error?: string;
}

let multiplayerState: MultiplayerSessionState = { phase: "idle" };

function detectPeerRole(): string {
	if (!RunService.IsRunning()) return "edit";
	if (RunService.IsServer()) return "server";
	return "client";
}

function getPlayersSnapshot() {
	const players = Players.GetPlayers().map((player) => ({
		name: player.Name,
		userId: player.UserId,
		displayName: player.DisplayName,
	}));
	players.sort((a, b) => a.name < b.name);
	return players;
}

function cloneMultiplayerState(): MultiplayerSessionState {
	return {
		phase: multiplayerState.phase,
		testId: multiplayerState.testId,
		numPlayers: multiplayerState.numPlayers,
		testArgs: multiplayerState.testArgs,
		startedAt: multiplayerState.startedAt,
		completedAt: multiplayerState.completedAt,
		ok: multiplayerState.ok,
		result: multiplayerState.result,
		error: multiplayerState.error,
	};
}

function normalizeNumPlayers(value: unknown): number | undefined {
	if (!typeIs(value, "number")) return undefined;
	const n = math.floor(value);
	if (n !== value || n < 1 || n > 8) return undefined;
	return n;
}

function buildCommandListenerSource(): string {
	return `local LogService = game:GetService("LogService")
local PathfindingService = game:GetService("PathfindingService")
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local NAV_SIG = "${NAV_SIGNAL}"
local NAV_RES = "${NAV_RESULT}"
LogService.MessageOut:Connect(function(msg)
	if string.sub(msg, 1, #NAV_SIG + 1) == NAV_SIG .. ":" then
		local json = string.sub(msg, #NAV_SIG + 2)
		task.spawn(function()
			local ok, d = pcall(function() return HttpService:JSONDecode(json) end)
			if not ok or not d then
				print(NAV_RES .. ':{"success":false,"error":"parse_error"}')
				return
			end
			local ps = Players:GetPlayers()
			if #ps == 0 then
				print(NAV_RES .. ':{"success":false,"error":"no_players"}')
				return
			end
			local char = ps[1].Character or ps[1].CharacterAdded:Wait()
			local hum = char:FindFirstChildOfClass("Humanoid")
			local root = char:FindFirstChild("HumanoidRootPart")
			if not hum or not root then
				print(NAV_RES .. ':{"success":false,"error":"no_humanoid"}')
				return
			end
			local target
			if d.instancePath then
				local parts = string.split(d.instancePath, ".")
				local cur = game
				for i = 2, #parts do
					cur = cur:FindFirstChild(parts[i])
					if not cur then
						print(NAV_RES .. ':{"success":false,"error":"instance_not_found"}')
						return
					end
				end
				if cur:IsA("BasePart") then target = cur.Position
				elseif cur:IsA("Model") and cur.PrimaryPart then target = cur.PrimaryPart.Position
				else target = cur:GetPivot().Position end
			else
				target = Vector3.new(d.x or 0, d.y or 0, d.z or 0)
			end
			local path = PathfindingService:CreatePath({AgentRadius=2,AgentHeight=5,AgentCanJump=true})
			local pok = pcall(function() path:ComputeAsync(root.Position, target) end)
			local method = "direct"
			if pok and path.Status == Enum.PathStatus.Success then
				method = "pathfinding"
				for _, wp in ipairs(path:GetWaypoints()) do
					hum:MoveTo(wp.Position)
					if wp.Action == Enum.PathWaypointAction.Jump then hum.Jump = true end
					hum.MoveToFinished:Wait()
				end
			else
				hum:MoveTo(target)
				hum.MoveToFinished:Wait()
			end
			local fp = root.Position
			print(NAV_RES .. ':{"success":true,"method":"' .. method .. '","position":[' .. fp.X .. ',' .. fp.Y .. ',' .. fp.Z .. ']}')
		end)
	end
end)`;
}

function injectStopListener() {
	const listener = new Instance("Script");
	listener.Name = "__MCP_CommandListener";
	listener.Parent = ServerScriptService;

	const source = buildCommandListenerSource();
	const [seOk] = pcall(() => {
		ScriptEditorService.UpdateSourceAsync(listener, () => source);
	});
	if (!seOk) {
		(listener as unknown as { Source: string }).Source = source;
	}

	stopListenerScript = listener;
}

function cleanupStopListener() {
	if (stopListenerScript) {
		pcall(() => stopListenerScript!.Destroy());
		stopListenerScript = undefined;
	}
}

function disconnectNavLogListener() {
	if (navLogConnection) {
		navLogConnection.Disconnect();
		navLogConnection = undefined;
	}
}

function startPlaytest(requestData: Record<string, unknown>) {
	const mode = requestData.mode as string | undefined;
	const numPlayers = requestData.numPlayers as number | undefined;

	if (mode !== "play" && mode !== "run") {
		return { error: 'mode must be "play" or "run"' };
	}

	if (numPlayers !== undefined) {
		return { error: "start_playtest is single-player only. Use multiplayer_test_start for multi-client StudioTestService sessions." };
	}

	// Self-heal: if testRunning is stuck true but Studio reports no active
	// playtest, the previous start_playtest's task.spawn was orphaned
	// (plugin reload mid-test, Studio entered some inconsistent state, etc).
	// Reset it so subsequent starts don't hit a false "already running".
	if (testRunning && !RunService.IsRunning()) {
		testRunning = false;
		disconnectNavLogListener();
		cleanupStopListener();
		// Runtime eval bridges are created by the play server/client plugin
		// peers and disappear with the play DataModels.
	}

	if (testRunning) {
		return { error: "A test is already running" };
	}

	testRunning = true;

	cleanupStopListener();
	disconnectNavLogListener();

	navLogConnection = LogService.MessageOut.Connect((message) => {
		if (message.sub(1, NAV_RESULT.size() + 1) === `${NAV_RESULT}:`) {
			if (navResultCallback) {
				navResultCallback(message.sub(NAV_RESULT.size() + 2));
			}
		}
	});

	const [injected, injErr] = pcall(() => injectStopListener());
	if (!injected) {
		warn(`[BloxForge] Failed to inject stop listener: ${injErr}`);
	}

	task.spawn(() => {
		const [ok, result] = pcall(() => {
			if (mode === "play") {
				return StudioTestService.ExecutePlayModeAsync({});
			}
			return StudioTestService.ExecuteRunModeAsync({});
		});

		if (!ok) {
			warn(`[BloxForge] Playtest ended with error: ${result}`);
		}

		disconnectNavLogListener();
		testRunning = false;

		cleanupStopListener();
	});

	const response: Record<string, unknown> = {
		success: true,
		message: `Playtest started in ${mode} mode.`,
	};

	return response;
}

function stopPlaytest(_requestData: Record<string, unknown>) {
	// Signal the play-server DM's StopPlayMonitor via plugin:SetSetting.
	// The monitor acknowledges with the matching request id only after its
	// StudioTestService:EndTest call returns from pcall.
	const stopRequest = StopPlayMonitor.requestStop();
	if (!stopRequest.ok || stopRequest.requestId === undefined) {
		return { error: "Plugin not ready. Try again in a moment." };
	}
	const consumption = StopPlayMonitor.waitForConsumption(stopRequest.requestId);
	if (!consumption.ok) {
		// Two distinct failure modes collapse here, distinguished by whether
		// THIS edit DM has a playtest tracked:
		//
		// - testRunning=false: no playtest was running from this edit DM
		//   (true negative). Return "no active playtest" — fine to retry only
		//   after actually starting a playtest.
		// - testRunning=true: a playtest IS running but the cross-DM signal
		//   didn't propagate within the consumption timeout (false negative
		//   from the caller's perspective — playtest may actually have ended).
		//   Tell the caller it's a timing issue and they can retry.
		//
		// Either way clean up the pending request so a future playtest's monitor
		// doesn't fire EndTest on startup against a stale signal.
		StopPlayMonitor.clearPending(stopRequest.requestId);
		if (testRunning) {
			return {
				error:
					"Playtest stop signal failed or was not acknowledged. " +
					"The playtest may have ended anyway; check get_connected_instances.",
				detail: consumption.error,
			};
		}
		if (consumption.consumed) {
			return { error: "Playtest stop request reached the play server, but EndTest failed.", detail: consumption.error };
		}
		return { error: "No active playtest to stop.", detail: consumption.error };
	}
	StopPlayMonitor.clearPending(stopRequest.requestId);
	// Request was consumed (EndTest called). ExecutePlayModeAsync in our
	// startPlaytest task.spawn is still unwinding though — testRunning stays
	// true until that yield completes and the post-block runs. Wait so
	// back-to-back stop -> start sequences don't race against the prior
	// teardown and get "A test is already running". 10s covers play-DM
	// teardown on heavier places; if it still hasn't cleared we return
	// anyway so users aren't stuck — but note that in the response so the
	// caller knows a subsequent start may need a moment.
	const deadline = tick() + 10;
	while (testRunning && tick() < deadline) {
		task.wait(0.1);
	}
	if (testRunning) {
		return {
			success: true,
			alreadyEnded: consumption.alreadyEnded,
			message: "Playtest stop signal sent; teardown still in progress.",
		};
	}
	return { success: true, alreadyEnded: consumption.alreadyEnded, message: "Playtest stopped." };
}

function multiplayerTestStart(requestData: Record<string, unknown>) {
	if (RunService.IsRunning()) {
		return { error: "multiplayer_test_start must be called on the edit DataModel. Route with target=edit." };
	}

	const numPlayers = normalizeNumPlayers(requestData.numPlayers);
	if (numPlayers === undefined) {
		return { error: "numPlayers must be an integer from 1 to 8" };
	}

	if (multiplayerState.phase === "starting" || multiplayerState.phase === "running") {
		return {
			error: "A multiplayer Studio test is already running",
			state: cloneMultiplayerState(),
		};
	}

	const testArgs = requestData.testArgs !== undefined ? requestData.testArgs : {};
	const testId = HttpService.GenerateGUID(false);

	multiplayerState = {
		phase: "starting",
		testId,
		numPlayers,
		testArgs,
		startedAt: tick(),
	};

	task.spawn(() => {
		multiplayerState.phase = "running";
		const [ok, result] = pcall(() => {
			return StudioTestService.ExecuteMultiplayerTestAsync(numPlayers, testArgs);
		});

		multiplayerState.completedAt = tick();
		multiplayerState.ok = ok;
		if (ok) {
			multiplayerState.phase = "completed";
			multiplayerState.result = result;
			multiplayerState.error = undefined;
		} else {
			multiplayerState.phase = "failed";
			multiplayerState.result = undefined;
			multiplayerState.error = tostring(result);
		}
	});

	const response: Record<string, unknown> = {
		success: true,
		message: `Multiplayer Studio test starting with ${numPlayers} player(s).`,
		testId,
		phase: multiplayerState.phase,
		numPlayers,
		testArgs,
	};
	return response;
}

function multiplayerTestState(_requestData: Record<string, unknown>) {
	const peer = detectPeerRole();
	const response: Record<string, unknown> = {
		success: true,
		peer,
		isRunning: RunService.IsRunning(),
		isRunMode: RunService.IsRunMode(),
		editModeActive: StudioTestService.EditModeActive,
	};

	if (peer === "edit") {
		response.session = cloneMultiplayerState();
		return response;
	}

	const [argsOk, args] = pcall(() => StudioTestService.GetTestArgs());
	response.testArgsOk = argsOk;
	response.testArgs = argsOk ? args : undefined;
	if (!argsOk) response.testArgsError = tostring(args);

	const players = getPlayersSnapshot();
	response.players = players;
	response.playerCount = players.size();

	if (peer === "client") {
		response.localPlayer = Players.LocalPlayer ? Players.LocalPlayer.Name : undefined;
		const [canLeaveOk, canLeave] = pcall(() => StudioTestService.CanLeaveTest());
		response.canLeaveOk = canLeaveOk;
		response.canLeave = canLeaveOk ? canLeave : false;
		if (!canLeaveOk) response.canLeaveError = tostring(canLeave);
	}

	return response;
}

function multiplayerTestAddPlayers(requestData: Record<string, unknown>) {
	if (!RunService.IsRunning() || !RunService.IsServer()) {
		return { error: "multiplayer_test_add_players must be called on the running server peer. Route with target=server." };
	}
	const numPlayers = normalizeNumPlayers(requestData.numPlayers);
	if (numPlayers === undefined) {
		return { error: "numPlayers must be an integer from 1 to 8" };
	}

	const before = Players.GetPlayers().size();
	const [ok, result] = pcall(() => StudioTestService.AddPlayers(numPlayers));
	if (!ok) {
		return { error: tostring(result) };
	}

	const deadline = tick() + ((requestData.timeout as number | undefined) ?? 10);
	while (Players.GetPlayers().size() < before + numPlayers && tick() < deadline) {
		task.wait(0.1);
	}

	const players = getPlayersSnapshot();
	return {
		success: true,
		message: `Requested ${numPlayers} additional player(s).`,
		playerCount: players.size(),
		players,
	};
}

function multiplayerTestLeaveClient(_requestData: Record<string, unknown>) {
	if (!RunService.IsRunning() || RunService.IsServer()) {
		return { error: "multiplayer_test_leave_client must be called on a running client peer. Route with target=client-N." };
	}

	const [canLeaveOk, canLeave] = pcall(() => StudioTestService.CanLeaveTest());
	if (!canLeaveOk) {
		return { error: tostring(canLeave), canLeaveOk: false };
	}
	if (!canLeave) {
		return { error: "This client cannot leave the current test session.", canLeaveOk: true, canLeave: false };
	}

	const localPlayer = Players.LocalPlayer ? Players.LocalPlayer.Name : undefined;
	task.defer(() => {
		pcall(() => StudioTestService.LeaveTest());
	});
	return {
		success: true,
		message: "Client leave requested.",
		localPlayer,
	};
}

function multiplayerTestEnd(requestData: Record<string, unknown>) {
	if (!RunService.IsRunning() || !RunService.IsServer()) {
		return { error: "multiplayer_test_end must be called on the running server peer. Route with target=server." };
	}

	const value = requestData.value !== undefined ? requestData.value : "ended_by_mcp";
	const [ok, result] = pcall(() => StudioTestService.EndTest(value));
	if (!ok) {
		if (tostring(result).find("EndTest can only be called once")[0] !== undefined || tostring(result).find("can only be called once")[0] !== undefined) {
			return {
				success: true,
				alreadyEnded: true,
				message: "StudioTestService:EndTest was already called; teardown is in progress.",
				value,
			};
		}
		return { error: tostring(result) };
	}
	return {
		success: true,
		message: "Multiplayer Studio test end requested.",
		value,
	};
}

function characterNavigation(requestData: Record<string, unknown>) {
	if (!testRunning) {
		return { error: "Playtest must be running. Start a playtest in 'play' mode first." };
	}

	const position = requestData.position as number[] | undefined;
	const instancePath = requestData.instancePath as string | undefined;
	const waitForCompletion = (requestData.waitForCompletion as boolean) ?? true;
	const timeout = (requestData.timeout as number) ?? 25;

	if (!position && !instancePath) {
		return { error: "Either position [x, y, z] or instancePath is required" };
	}

	let navData: string;
	if (position) {
		navData = HttpService.JSONEncode({ x: position[0], y: position[1], z: position[2] });
	} else {
		navData = HttpService.JSONEncode({ instancePath });
	}

	warn(`${NAV_SIGNAL}:${navData}`);

	if (!waitForCompletion) {
		return { success: true, message: "Navigation command sent" };
	}

	let result: string | undefined;
	navResultCallback = (json: string) => {
		result = json;
	};

	const startTime = tick();
	while (!result && tick() - startTime < timeout) {
		task.wait(0.2);
	}
	navResultCallback = undefined;

	if (result) {
		const [ok, parsed] = pcall(() => HttpService.JSONDecode(result!));
		if (ok) return parsed;
		return { success: true, rawResult: result };
	}
	return { error: `Navigation timed out after ${timeout} seconds` };
}

export = {
	startPlaytest,
	stopPlaytest,
	multiplayerTestStart,
	multiplayerTestState,
	multiplayerTestAddPlayers,
	multiplayerTestLeaveClient,
	multiplayerTestEnd,
	characterNavigation,
};
