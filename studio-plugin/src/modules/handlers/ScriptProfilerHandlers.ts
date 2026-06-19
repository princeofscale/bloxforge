const HttpService = game.GetService("HttpService");
const Players = game.GetService("Players");
const RunService = game.GetService("RunService");

interface ScriptProfilerServiceLike extends Instance {
	ServerStart(this: ScriptProfilerServiceLike, frequency?: number): void;
	ServerStop(this: ScriptProfilerServiceLike): void;
	ServerRequestData(this: ScriptProfilerServiceLike): void;
	ClientStart(this: ScriptProfilerServiceLike, player: Player, frequency?: number): void;
	ClientStop(this: ScriptProfilerServiceLike, player: Player): void;
	ClientRequestData(this: ScriptProfilerServiceLike, player: Player): void;
	OnNewData: RBXScriptSignal<(player: Player | undefined, jsonString: string) => void>;
}

interface CategoryInfo {
	Name?: string;
	NodeId?: number;
}

interface FunctionInfo {
	Source?: string;
	Name?: string;
	Line?: number;
	TotalDuration?: number;
	Flags?: number;
}

interface ProfilingInfo {
	Version?: number;
	SessionStartTime?: number;
	SessionEndTime?: number;
	Categories?: CategoryInfo[];
	Nodes?: unknown[];
	Functions?: FunctionInfo[];
}

interface FunctionRow {
	function_index: number;
	name: string;
	source?: string;
	line?: number;
	total_us: number;
	is_native?: boolean;
	is_plugin?: boolean;
	is_debug_label?: boolean;
}

const DEFAULT_DURATION_MS = 1000;
const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 15000;
const DEFAULT_FREQUENCY = 1000;
const DEFAULT_MAX_FUNCTIONS = 20;

function getProfilerService(): ScriptProfilerServiceLike | Record<string, unknown> {
	const provider = game as unknown as { GetService(serviceName: string): Instance };
	const [ok, service] = pcall(() => provider.GetService("ScriptProfilerService") as ScriptProfilerServiceLike);
	if (!ok || !service) {
		return {
			error: "script_profiler_unavailable",
			message: `ScriptProfilerService is unavailable: ${tostring(service)}`,
		};
	}
	return service;
}

function normalizeDurationMs(value: unknown): number {
	if (!typeIs(value, "number")) return DEFAULT_DURATION_MS;
	return math.clamp(math.floor(value), MIN_DURATION_MS, MAX_DURATION_MS);
}

function normalizeFrequency(value: unknown): number {
	if (!typeIs(value, "number")) return DEFAULT_FREQUENCY;
	return math.clamp(math.floor(value), 1, 10000);
}

function normalizeMaxFunctions(value: unknown): number {
	if (!typeIs(value, "number")) return DEFAULT_MAX_FUNCTIONS;
	return math.clamp(math.floor(value), 1, 100);
}

function normalizeMinTotalUs(requestData: Record<string, unknown>): number {
	const value = requestData.min_total_us;
	if (typeIs(value, "number")) return math.max(0, value);
	return 0;
}

function stringContains(haystack: string, needle: string): boolean {
	return string.find(string.lower(haystack), string.lower(needle), 1, true)[0] !== undefined;
}

function localPlayer(): Player | undefined {
	let player = Players.LocalPlayer;
	const started = tick();
	while (!player && tick() - started < 5) {
		task.wait(0.05);
		player = Players.LocalPlayer;
	}
	return player;
}

function functionDisplayName(func: FunctionInfo): string {
	if (typeIs(func.Name, "string") && func.Name !== "") return func.Name;
	if (typeIs(func.Source, "string") && func.Source !== "") {
		if (typeIs(func.Line, "number") && func.Line > 0) return `${func.Source}:${func.Line}`;
		return func.Source;
	}
	return "<anonymous>";
}

function flagsOf(func: FunctionInfo): number {
	return typeIs(func.Flags, "number") ? func.Flags : 0;
}

function isNativeFunction(func: FunctionInfo): boolean {
	return bit32.band(flagsOf(func), 1) !== 0;
}

function isPluginFunction(func: FunctionInfo): boolean {
	if (bit32.band(flagsOf(func), 2) !== 0) return true;
	return typeIs(func.Source, "string") && string.find(func.Source, "MCPPlugin", 1, true)[0] !== undefined;
}

function isDebugLabel(func: FunctionInfo, filter: string | undefined): boolean {
	if (filter === undefined) return false;
	if (!typeIs(func.Name, "string") || func.Name === "") return false;
	if (!typeIs(func.Source, "string") || func.Source === "" || func.Source === "[C]" || func.Source === "GC") return false;
	if (func.Line !== undefined && func.Line !== 0) return false;
	if (isNativeFunction(func) || isPluginFunction(func)) return false;
	return stringContains(func.Name, filter) || stringContains(func.Source, filter);
}

function pctOfCapture(row: FunctionRow, durationMs: number): number | undefined {
	const captureUs = durationMs * 1000;
	if (captureUs <= 0) return undefined;
	return math.floor((row.total_us / captureUs) * 10000 + 0.5) / 100;
}

function compactFunction(row: FunctionRow, rank: number, durationMs: number): Record<string, unknown> {
	const out: Record<string, unknown> = {
		rank,
		function_index: row.function_index,
		name: row.name,
		total_us: math.floor(row.total_us + 0.5),
	};
	const pct = pctOfCapture(row, durationMs);
	if (pct !== undefined) out.pct_of_capture = pct;
	if (row.source !== undefined) out.source = row.source;
	if (row.line !== undefined) out.line = row.line;
	if (row.is_native === true) out.is_native = true;
	if (row.is_plugin === true) out.is_plugin = true;
	if (row.is_debug_label === true) out.is_debug_label = true;
	return out;
}

function summarizeProfile(
	rawJson: string,
	profile: ProfilingInfo,
	requestData: Record<string, unknown>,
	durationMs: number,
	frequency: number,
	eventPlayerName: string | undefined,
): Record<string, unknown> {
	const funcs = typeIs(profile.Functions, "table") ? profile.Functions : [];
	const nodes = typeIs(profile.Nodes, "table") ? profile.Nodes : [];
	const categories = typeIs(profile.Categories, "table") ? profile.Categories : [];
	const maxFunctions = normalizeMaxFunctions(requestData.max_functions);
	const minTotalUs = normalizeMinTotalUs(requestData);
	const includeNative = requestData.include_native === true;
	const includePlugin = requestData.include_plugin === true;
	const filter = typeIs(requestData.filter, "string") && requestData.filter !== "" ? requestData.filter as string : undefined;

	const rows: FunctionRow[] = [];
	const debugRows: FunctionRow[] = [];
	let omittedNative = 0;
	let omittedPlugin = 0;
	let omittedBelowThreshold = 0;
	let omittedByFilter = 0;

	for (let i = 0; i < funcs.size(); i++) {
		const func = funcs[i];
		if (!typeIs(func, "table")) continue;
		const info = func as FunctionInfo;
		const totalUs = typeIs(info.TotalDuration, "number") ? info.TotalDuration : 0;
		const name = functionDisplayName(info);
		const row: FunctionRow = {
			function_index: i + 1,
			name,
			source: typeIs(info.Source, "string") ? info.Source : undefined,
			line: typeIs(info.Line, "number") ? info.Line : undefined,
			total_us: totalUs,
			is_native: isNativeFunction(info) ? true : undefined,
			is_plugin: isPluginFunction(info) ? true : undefined,
			is_debug_label: isDebugLabel(info, filter) ? true : undefined,
		};

		if (!includeNative && row.is_native === true) {
			omittedNative += 1;
			continue;
		}
		if (!includePlugin && row.is_plugin === true) {
			omittedPlugin += 1;
			continue;
		}
		if (totalUs < minTotalUs) {
			omittedBelowThreshold += 1;
			continue;
		}
		if (filter !== undefined) {
			const text = `${row.name} ${row.source ?? ""}`;
			if (!stringContains(text, filter)) {
				omittedByFilter += 1;
				continue;
			}
		}
		rows.push(row);
		if (row.is_debug_label === true) debugRows.push(row);
	}

	rows.sort((a, b) => a.total_us > b.total_us);
	debugRows.sort((a, b) => a.total_us > b.total_us);

	const topFunctions: Record<string, unknown>[] = [];
	for (let i = 0; i < math.min(maxFunctions, rows.size()); i++) {
		topFunctions.push(compactFunction(rows[i], i + 1, durationMs));
	}

	const debugLabels: Record<string, unknown>[] = [];
	for (let i = 0; i < math.min(maxFunctions, debugRows.size()); i++) {
		debugLabels.push(compactFunction(debugRows[i], i + 1, durationMs));
	}

	const categoryNames: string[] = [];
	for (let i = 0; i < categories.size(); i++) {
		const category = categories[i];
		if (typeIs(category, "table")) {
			const name = (category as CategoryInfo).Name;
			if (typeIs(name, "string")) categoryNames.push(name);
		}
	}

	const omitted: Record<string, number> = {};
	let hasOmitted = false;
	if (omittedNative > 0) {
		omitted.native = omittedNative;
		hasOmitted = true;
	}
	if (omittedPlugin > 0) {
		omitted.plugin = omittedPlugin;
		hasOmitted = true;
	}
	if (omittedBelowThreshold > 0) {
		omitted.below_min_total_us = omittedBelowThreshold;
		hasOmitted = true;
	}
	if (omittedByFilter > 0) {
		omitted.filtered_out = omittedByFilter;
		hasOmitted = true;
	}

	const result: Record<string, unknown> = {
		ok: true,
		duration_ms: durationMs,
		frequency,
		applied: {
			filter: filter ?? undefined,
			min_total_us: minTotalUs,
			include_native: includeNative,
			include_plugin: includePlugin,
			max_functions: maxFunctions,
			sort: "total_us_desc",
		},
		json_bytes: rawJson.size(),
		counts: {
			categories: categories.size(),
			nodes: nodes.size(),
			functions: funcs.size(),
		},
		top_functions: topFunctions,
		debug_labels: debugLabels,
	};
	if (categoryNames.size() > 0) result.categories = categoryNames;
	if (hasOmitted) result.omitted = omitted;
	if (profile.Version !== undefined) result.version = profile.Version;
	if (profile.SessionStartTime !== undefined || profile.SessionEndTime !== undefined) {
		result.session = {
			start_time: profile.SessionStartTime,
			end_time: profile.SessionEndTime,
		};
	}
	if (eventPlayerName !== undefined) result.player = eventPlayerName;
	if (requestData.__mcp_include_raw_json === true) result.raw_json = rawJson;
	return result;
}

function captureScriptProfiler(requestData: Record<string, unknown>): unknown {
	if (!RunService.IsRunning()) {
		return {
			error: "runtime_target_required",
			message: "Script profiler capture requires a running playtest target such as target=\"server\" or target=\"client-1\".",
		};
	}

	const serviceOrError = getProfilerService();
	if (!serviceOrError.IsA) return serviceOrError;
	const service = serviceOrError as ScriptProfilerServiceLike;

	const durationMs = normalizeDurationMs(requestData.duration_ms);
	const frequency = normalizeFrequency(requestData.frequency);
	const isServer = RunService.IsServer();
	const isClient = RunService.IsClient() && !isServer;
	const player = isClient ? localPlayer() : undefined;
	if (!isServer && !player) {
		return {
			error: "client_player_unavailable",
			message: "Could not resolve Players.LocalPlayer for client profiling.",
		};
	}

	let rawJson: string | undefined;
	let eventPlayerName: string | undefined;
	const connection = service.OnNewData.Connect((playerArg: Player | undefined, jsonString: string) => {
		if (rawJson !== undefined) return;
		rawJson = jsonString;
		if (playerArg) eventPlayerName = playerArg.Name;
	});

	const [startOk, startErr] = pcall(() => {
		if (isServer) {
			service.ServerStart(frequency);
		} else {
			service.ClientStart(player!, frequency);
		}
	});
	if (!startOk) {
		connection.Disconnect();
		return {
			error: "script_profiler_start_failed",
			message: tostring(startErr),
		};
	}

	task.wait(durationMs / 1000);

	const [stopOk, stopErr] = pcall(() => {
		if (isServer) {
			service.ServerStop();
			service.ServerRequestData();
		} else {
			service.ClientStop(player!);
			service.ClientRequestData(player!);
		}
	});
	if (!stopOk) {
		connection.Disconnect();
		return {
			error: "script_profiler_stop_failed",
			message: tostring(stopErr),
		};
	}

	const requestedAt = tick();
	while (rawJson === undefined && tick() - requestedAt < 5) {
		task.wait(0.05);
	}
	connection.Disconnect();

	if (rawJson === undefined) {
		return {
			error: "script_profiler_data_timeout",
			message: "ScriptProfilerService did not emit OnNewData after requesting profiler data.",
		};
	}

	const [decodeOk, decoded] = pcall(() => HttpService.JSONDecode(rawJson!));
	if (!decodeOk) {
		return {
			error: "script_profiler_decode_failed",
			message: tostring(decoded),
			json_bytes: rawJson.size(),
		};
	}

	return summarizeProfile(rawJson, decoded as ProfilingInfo, requestData, durationMs, frequency, eventPlayerName);
}

export = { captureScriptProfiler };
