import Utils from "../Utils";
import Recording from "../Recording";

const ScriptEditorService = game.GetService("ScriptEditorService");
const HttpService = game.GetService("HttpService");

const { getInstancePath, getInstanceByPath, readScriptSource, splitLines, joinLines } = Utils;
const { beginRecording, finishRecording } = Recording;

function normalizeEscapes(s: string): string {
	return s;
}

function updateScriptSourceVerified(instance: LuaSourceContainer, newSource: string) {
	ScriptEditorService.UpdateSourceAsync(instance, () => newSource);
	if (readScriptSource(instance) !== newSource) {
		error("UpdateSourceAsync completed without updating the live script draft");
	}
}

function getScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number | undefined;
	const endLine = requestData.endLine as number | undefined;

	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const [success, result] = pcall(() => {
		const fullSource = readScriptSource(instance);
		const [lines, hasTrailingNewline] = splitLines(fullSource);
		const totalLineCount = lines.size();

		let sourceToReturn = fullSource;
		let returnedStartLine = 1;
		let returnedEndLine = totalLineCount;

		if (startLine !== undefined || endLine !== undefined) {
			const actualStartLine = math.max(1, startLine ?? 1);
			const actualEndLine = math.min(lines.size(), endLine ?? lines.size());

			const selectedLines: string[] = [];
			for (let i = actualStartLine; i <= actualEndLine; i++) {
				selectedLines.push(lines[i - 1] ?? "");
			}

			sourceToReturn = selectedLines.join("\n");
			if (hasTrailingNewline && actualEndLine === lines.size() && sourceToReturn.sub(-1) !== "\n") {
				sourceToReturn += "\n";
			}
			returnedStartLine = actualStartLine;
			returnedEndLine = actualEndLine;
		}

		const numberedLines: string[] = [];
		const linesToNumber = startLine !== undefined ? splitLines(sourceToReturn)[0] : lines;
		const lineOffset = returnedStartLine - 1;
		for (let i = 0; i < linesToNumber.size(); i++) {
			numberedLines.push(`${i + 1 + lineOffset}: ${linesToNumber[i]}`);
		}
		const numberedSource = numberedLines.join("\n");

		const resp: Record<string, unknown> = {
			instancePath,
			className: instance.ClassName,
			name: instance.Name,
			source: sourceToReturn,
			numberedSource,
			sourceLength: fullSource.size(),
			lineCount: totalLineCount,
			startLine: returnedStartLine,
			endLine: returnedEndLine,
			isPartial: startLine !== undefined || endLine !== undefined,
			truncated: false,
		};

		if (startLine === undefined && endLine === undefined && fullSource.size() > 50000) {
			const truncatedLines: string[] = [];
			const truncatedNumberedLines: string[] = [];
			const maxLines = math.min(1000, lines.size());
			for (let i = 0; i < maxLines; i++) {
				truncatedLines.push(lines[i]);
				truncatedNumberedLines.push(`${i + 1}: ${lines[i]}`);
			}
			resp.source = truncatedLines.join("\n");
			resp.numberedSource = truncatedNumberedLines.join("\n");
			resp.truncated = true;
			resp.endLine = maxLines;
			resp.note = "Script truncated to first 1000 lines. Use startLine/endLine parameters to read specific sections.";
		}

		if (instance.IsA("BaseScript")) {
			resp.enabled = instance.Enabled;
		}

		let topServiceInst: Instance = instance;
		while (topServiceInst.Parent && topServiceInst.Parent !== game) {
			topServiceInst = topServiceInst.Parent;
		}
		resp.topService = topServiceInst.Name;

		return resp;
	});

	if (success) {
		return result;
	} else {
		return { error: `Failed to get script source: ${result}` };
	}
}

// Two independent rolling hashes plus the byte length. A single 31-bit hash
// collides often enough that a changed script could be reported as unchanged and
// never resynced. Must stay identical to `studioHash` in packages/core.
function sourceHash(source: string): string {
	let djb2 = 5381;
	let sdbm = 0;
	for (let i = 1; i <= source.size(); i++) {
		const byte = string.byte(source, i)[0];
		djb2 = (djb2 * 33 + byte) % 2147483647;
		sdbm = (sdbm * 65599 + byte) % 2147483647;
	}
	return `djb2:${string.format("%08x", djb2)}:${string.format("%08x", sdbm)}:${source.size()}`;
}

function instancePathSegments(instance: Instance): string[] {
	const segments: string[] = [];
	let current: Instance | undefined = instance;
	while (current && current !== game) {
		segments.unshift(current.Name);
		current = current.Parent;
	}
	return segments;
}

interface ManagedScriptSnapshot {
	createdAt: number;
	rootPath: string;
	scripts: Array<{ instance: LuaSourceContainer; path: string }>;
}

const managedScriptSnapshots = new Map<string, ManagedScriptSnapshot>();
const MANAGED_SNAPSHOT_TTL_SECONDS = 30;
const MAX_MANAGED_SNAPSHOTS = 4;
const MAX_MANAGED_SCRIPTS = 10000;

function createManagedScriptSnapshot(rootPath: string, root: Instance): LuaTuple<[string, ManagedScriptSnapshot]> {
	const now = os.clock();
	for (const [id, snapshot] of managedScriptSnapshots) {
		if (now - snapshot.createdAt > MANAGED_SNAPSHOT_TTL_SECONDS) managedScriptSnapshots.delete(id);
	}
	while (managedScriptSnapshots.size() >= MAX_MANAGED_SNAPSHOTS) {
		let oldestId: string | undefined;
		let oldestAt = math.huge;
		for (const [id, snapshot] of managedScriptSnapshots) {
			if (snapshot.createdAt < oldestAt) {
				oldestId = id;
				oldestAt = snapshot.createdAt;
			}
		}
		if (oldestId === undefined) break;
		managedScriptSnapshots.delete(oldestId);
	}

	const scripts: ManagedScriptSnapshot["scripts"] = [];
	const candidates = root === game ? game.GetDescendants() : [root, ...root.GetDescendants()];
	for (const candidate of candidates) {
		if (candidate.IsA("LuaSourceContainer")) {
			if (scripts.size() >= MAX_MANAGED_SCRIPTS) {
				error(`Managed script read exceeds ${MAX_MANAGED_SCRIPTS} items`);
			}
			scripts.push({ instance: candidate, path: getInstancePath(candidate) });
		}
	}
	scripts.sort((a, b) => a.path < b.path);
	const id = HttpService.GenerateGUID(false);
	const snapshot = { createdAt: now, rootPath, scripts };
	managedScriptSnapshots.set(id, snapshot);
	return $tuple(id, snapshot);
}

function readManagedScripts(requestData: Record<string, unknown>) {
	const rootPath = (requestData.rootPath as string | undefined) ?? "game";
	const limit = math.clamp((requestData.limit as number | undefined) ?? 50, 1, 100);
	const maxSourceBytes = math.clamp(
		(requestData.maxSourceBytes as number | undefined) ?? 256 * 1024,
		0,
		1024 * 1024,
	);
	const continuationToken = requestData.continuationToken as string | undefined;
	const knownHashes = (requestData.knownHashes as Record<string, string> | undefined) ?? {};
	const root = getInstanceByPath(rootPath);
	if (!root) return { error: `Instance not found: ${rootPath}` };

	let snapshotId: string;
	let snapshot: ManagedScriptSnapshot;
	let start = 0;
	if (continuationToken === undefined) {
		[snapshotId, snapshot] = createManagedScriptSnapshot(rootPath, root);
	} else {
		const parts = continuationToken.split(":");
		const parsedStart = tonumber(parts[1]);
		const existing = parts.size() === 2 ? managedScriptSnapshots.get(parts[0]) : undefined;
		if (parsedStart === undefined || parsedStart < 0 || parsedStart % 1 !== 0 || !existing || existing.rootPath !== rootPath) {
			return { error: "continuationToken is invalid or expired" };
		}
		start = parsedStart;
		snapshotId = parts[0];
		snapshot = existing;
	}

	const items: Array<Record<string, unknown>> = [];
	let sourceBytes = 0;
	let cursor = start;
	while (cursor < snapshot.scripts.size() && items.size() < limit) {
		const entry = snapshot.scripts[cursor];
		const source = readScriptSource(entry.instance);
		const hash = sourceHash(source);
		const unchanged = knownHashes[entry.path] === hash;
		const includeSource = !unchanged && sourceBytes + source.size() <= maxSourceBytes;
		// A changed script that fits a fresh page but not the remaining budget
		// must start the next page. Emitting it with sourceOmitted would make the
		// caller file it under "too large" and never fetch it again.
		if (!unchanged && !includeSource && source.size() <= maxSourceBytes && items.size() > 0) {
			break;
		}
		items.push({
			path: entry.path,
			pathSegments: instancePathSegments(entry.instance),
			name: entry.instance.Name,
			className: entry.instance.ClassName,
			sourceHash: hash,
			sourceLength: source.size(),
			unchanged,
			sourceOmitted: !includeSource,
			...(includeSource ? { source } : {}),
		});
		if (includeSource) sourceBytes += source.size();
		cursor++;
	}
	const nextToken = cursor < snapshot.scripts.size() ? `${snapshotId}:${cursor}` : undefined;
	if (nextToken === undefined) managedScriptSnapshots.delete(snapshotId);

	return {
		rootPath,
		items,
		count: items.size(),
		total: snapshot.scripts.size(),
		sourceBytes,
		continuationToken: nextToken,
	};
}

function setScriptSource(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newSource = requestData.source as string;

	// An empty source is a legitimate edit — only a missing value is an error.
	if (!instancePath || !typeIs(newSource, "string")) {
		return { error: "Instance path and source are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const sourceToSet = normalizeEscapes(newSource);
	const recordingId = beginRecording(`Set script source: ${instance.Name}`);

	const [updateSuccess, updateResult] = pcall(() => {
		const oldSourceLength = readScriptSource(instance).size();

		updateScriptSourceVerified(instance, sourceToSet);

		return {
			success: true, instancePath,
			oldSourceLength, newSourceLength: sourceToSet.size(),
			method: "UpdateSourceAsync",
			message: "Script source updated successfully (editor-safe)",
		};
	});

	if (updateSuccess) {
		finishRecording(recordingId, true);
		return updateResult;
	}

	const [directSuccess, directResult] = pcall(() => {
		const oldSource = (instance as unknown as { Source: string }).Source;
		(instance as unknown as { Source: string }).Source = sourceToSet;

		return {
			success: true, instancePath,
			oldSourceLength: oldSource.size(), newSourceLength: sourceToSet.size(),
			method: "direct",
			message: "Script source updated successfully (direct assignment)",
		};
	});

	if (directSuccess) {
		finishRecording(recordingId, true);
		return directResult;
	}

	// There used to be a destroy-and-recreate fallback here. It preserved only
	// Name and Enabled, so it silently dropped attributes, tags, children, and
	// every reference pointing at the script. Failing loudly is the safe outcome.
	finishRecording(recordingId, false);
	return {
		error: `Failed to set script source. UpdateSourceAsync failed: ${updateResult}. Direct assignment failed: ${directResult}. The script was left untouched; close any open editor tab for it and retry.`,
	};
}

function editScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	let oldString = requestData.old_string as string;
	let newString = requestData.new_string as string;
	const startLine = requestData.startLine as number | undefined;

	if (!instancePath || oldString === undefined || newString === undefined) {
		return { error: "Instance path, old_string, and new_string are required" };
	}

	oldString = normalizeEscapes(oldString);
	newString = normalizeEscapes(newString);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Edit script: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const source = readScriptSource(instance);
		const searchLen = oldString.size();
		let matchStart: number;

		if (startLine !== undefined) {
			if (startLine < 1) error(`startLine must be >= 1 (got ${startLine})`);

			let lineStartByte = 1;
			let currentLine = 1;
			while (currentLine < startLine) {
				const [nlPos] = string.find(source, "\n", lineStartByte, true);
				if (nlPos === undefined) {
					error(`startLine ${startLine} is past end of script (${currentLine} lines)`);
				}
				lineStartByte = (nlPos as number) + 1;
				currentLine++;
			}

			const candidate = string.sub(source, lineStartByte, lineStartByte + searchLen - 1);
			if (candidate !== oldString) {
				error(`old_string does not match at line ${startLine}. Use get_script_source to verify the exact text at that line.`);
			}
			matchStart = lineStartByte;
		} else {
			let count = 0;
			let searchPos = 1;
			let firstMatch: number | undefined;
			while (true) {
				const [foundStart] = string.find(source, oldString, searchPos, true);
				if (foundStart === undefined) break;
				if (firstMatch === undefined) firstMatch = foundStart;
				count++;
				if (count > 1) break;
				searchPos = foundStart + searchLen;
			}
			if (count === 0) error("old_string not found in script. If old_string contains repeated patterns (e.g. closing braces), pass startLine to anchor the edit.");
			if (count > 1) error("old_string matches multiple locations. Provide more surrounding context, or pass startLine to anchor the edit to a specific line.");
			matchStart = firstMatch as number;
		}

		// Byte-slice replacement avoids Lua pattern escaping (safe for multi-byte chars like em dashes).
		const newSource = string.sub(source, 1, matchStart - 1) + newString + string.sub(source, matchStart + searchLen);

		updateScriptSourceVerified(instance, newSource);

		return {
			success: true,
			instancePath,
			message: "Script edited successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to edit script: ${result}` };
}

function insertScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const afterLine = (requestData.afterLine as number) ?? 0;
	let newContent = requestData.newContent as string;

	if (!instancePath || !newContent) return { error: "Instance path and newContent are required" };

	newContent = normalizeEscapes(newContent);

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Insert script lines after line ${afterLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (afterLine < 0 || afterLine > totalLines) error(`afterLine out of range (0-${totalLines})`);

		const [newLines] = splitLines(newContent);
		const resultLines: string[] = [];

		for (let i = 0; i < afterLine; i++) resultLines.push(lines[i]);
		for (const line of newLines) resultLines.push(line);
		for (let i = afterLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		updateScriptSourceVerified(instance, newSource);

		return {
			success: true, instancePath,
			insertedAfterLine: afterLine,
			linesInserted: newLines.size(),
			newLineCount: resultLines.size(),
			message: "Script lines inserted successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to insert script lines: ${result}` };
}

function deleteScriptLines(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const startLine = requestData.startLine as number;
	const endLine = requestData.endLine as number;

	if (!instancePath || !startLine || !endLine) {
		return { error: "Instance path, startLine, and endLine are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (!instance.IsA("LuaSourceContainer")) {
		return { error: `Instance is not a script-like object: ${instance.ClassName}` };
	}

	const recordingId = beginRecording(`Delete script lines ${startLine}-${endLine}: ${instance.Name}`);

	const [success, result] = pcall(() => {
		const [lines, hadTrailingNewline] = splitLines(readScriptSource(instance));
		const totalLines = lines.size();

		if (startLine < 1 || startLine > totalLines) error(`startLine out of range (1-${totalLines})`);
		if (endLine < startLine || endLine > totalLines) error(`endLine out of range (${startLine}-${totalLines})`);

		const resultLines: string[] = [];
		for (let i = 0; i < startLine - 1; i++) resultLines.push(lines[i]);
		for (let i = endLine; i < totalLines; i++) resultLines.push(lines[i]);

		const newSource = joinLines(resultLines, hadTrailingNewline);
		updateScriptSourceVerified(instance, newSource);

		return {
			success: true, instancePath,
			deletedLines: { startLine, endLine },
			linesDeleted: endLine - startLine + 1,
			newLineCount: resultLines.size(),
			message: "Script lines deleted successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to delete script lines: ${result}` };
}

function escapeLuaPattern(s: string): string {
	return s.gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")[0];
}

function escapeLuaReplacement(s: string): string {
	return s.gsub("%%", "%%%%")[0];
}

function caseInsensitiveLiteralReplace(src: string, searchStr: string, repl: string): [string, number] {
	const lowerSrc = src.lower();
	const lowerSearch = searchStr.lower();
	const parts: string[] = [];
	let lastEnd = 1;
	const searchLen = lowerSearch.size();
	let pos = 1;
	let replCount = 0;

	while (true) {
		const [foundStart] = string.find(lowerSrc, lowerSearch, pos, true);
		if (foundStart === undefined) break;
		parts.push(string.sub(src, lastEnd, foundStart - 1));
		parts.push(repl);
		lastEnd = foundStart + searchLen;
		pos = foundStart + searchLen;
		replCount++;
	}
	parts.push(string.sub(src, lastEnd));
	return [parts.join(""), replCount];
}

function findAndReplaceInScripts(requestData: Record<string, unknown>) {
	const searchPattern = requestData.pattern as string;
	const replacement = requestData.replacement as string;

	if (!searchPattern) return { error: "pattern is required" };
	if (replacement === undefined) return { error: "replacement is required" };

	const caseSensitive = (requestData.caseSensitive as boolean) ?? false;
	const usePattern = (requestData.usePattern as boolean) ?? false;
	const searchPath = (requestData.path as string) ?? "";
	const classFilter = requestData.classFilter as string | undefined;
	const dryRun = (requestData.dryRun as boolean) ?? false;
	const maxReplacements = (requestData.maxReplacements as number) ?? 1000;

	if (!caseSensitive && usePattern) {
		return { error: "Case-insensitive Lua pattern replacement is not supported. Use caseSensitive: true with usePattern: true, or use literal matching." };
	}

	const startInstance = searchPath !== "" ? getInstanceByPath(searchPath) : game;
	if (!startInstance) return { error: `Path not found: ${searchPath}` };

	interface ScriptChange {
		instancePath: string;
		name: string;
		className: string;
		replacements: number;
	}

	const changes: ScriptChange[] = [];
	let totalReplacements = 0;
	let scriptsSearched = 0;
	let hitLimit = false;

	const recordingId = dryRun ? undefined : beginRecording("Find and replace in scripts");

	function processInstance(instance: Instance) {
		if (hitLimit) return;

		if (instance.IsA("LuaSourceContainer")) {
			if (classFilter && !instance.ClassName.lower().find(classFilter.lower())[0]) return;

			scriptsSearched++;
			const source = readScriptSource(instance);

			let newSource: string;
			let replCount: number;

			if (usePattern) {
				const [result, count] = string.gsub(source, searchPattern, replacement);
				newSource = result;
				replCount = count;
			} else if (caseSensitive) {
				const escaped = escapeLuaPattern(searchPattern);
				const escapedRepl = escapeLuaReplacement(replacement);
				const [result, count] = string.gsub(source, escaped, escapedRepl);
				newSource = result;
				replCount = count;
			} else {
				[newSource, replCount] = caseInsensitiveLiteralReplace(source, searchPattern, replacement);
			}

			if (replCount > 0) {
				if (totalReplacements + replCount > maxReplacements) {
					hitLimit = true;
					return;
				}
				totalReplacements += replCount;

				if (!dryRun) {
					const [ok] = pcall(() => {
						updateScriptSourceVerified(instance, newSource);
					});
					if (!ok) {
						(instance as unknown as { Source: string }).Source = newSource;
					}
				}

				changes.push({
					instancePath: getInstancePath(instance),
					name: instance.Name,
					className: instance.ClassName,
					replacements: replCount,
				});
			}
		}

		for (const child of instance.GetChildren()) {
			if (hitLimit) return;
			processInstance(child);
		}
	}

	processInstance(startInstance);

	if (recordingId !== undefined) {
		finishRecording(recordingId, changes.size() > 0);
	}

	return {
		success: true,
		dryRun,
		pattern: searchPattern,
		replacement,
		totalReplacements,
		scriptsSearched,
		scriptsModified: changes.size(),
		changes,
		truncated: hitLimit,
	};
}

export = {
	getScriptSource,
	readManagedScripts,
	setScriptSource,
	editScriptLines,
	insertScriptLines,
	deleteScriptLines,
	findAndReplaceInScripts,
};
