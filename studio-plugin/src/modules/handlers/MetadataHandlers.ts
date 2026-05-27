import { CollectionService, LogService } from "@rbxts/services";
import Utils from "../Utils";
import Recording from "../Recording";

const ChangeHistoryService = game.GetService("ChangeHistoryService");
const Selection = game.GetService("Selection");

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

function serializeValue(value: unknown): unknown {
	const vType = typeOf(value);
	if (vType === "Vector3") {
		const v = value as Vector3;
		return { X: v.X, Y: v.Y, Z: v.Z, _type: "Vector3" };
	} else if (vType === "Color3") {
		const v = value as Color3;
		return { R: v.R, G: v.G, B: v.B, _type: "Color3" };
	} else if (vType === "CFrame") {
		const v = value as CFrame;
		return { Position: { X: v.Position.X, Y: v.Position.Y, Z: v.Position.Z }, _type: "CFrame" };
	} else if (vType === "UDim2") {
		const v = value as UDim2;
		return {
			X: { Scale: v.X.Scale, Offset: v.X.Offset },
			Y: { Scale: v.Y.Scale, Offset: v.Y.Offset },
			_type: "UDim2",
		};
	} else if (vType === "BrickColor") {
		const v = value as BrickColor;
		return { Name: v.Name, _type: "BrickColor" };
	}
	return value;
}

function deserializeValue(attributeValue: unknown, valueType?: string): unknown {
	if (!typeIs(attributeValue, "table")) return attributeValue;

	const tbl = attributeValue as Record<string, unknown>;
	const t = (tbl._type as string) ?? valueType;

	if (t === "Vector3") {
		return new Vector3((tbl.X as number) ?? 0, (tbl.Y as number) ?? 0, (tbl.Z as number) ?? 0);
	} else if (t === "Color3") {
		return new Color3((tbl.R as number) ?? 0, (tbl.G as number) ?? 0, (tbl.B as number) ?? 0);
	} else if (t === "UDim2") {
		const x = tbl.X as Record<string, number> | undefined;
		const y = tbl.Y as Record<string, number> | undefined;
		return new UDim2(x?.Scale ?? 0, x?.Offset ?? 0, y?.Scale ?? 0, y?.Offset ?? 0);
	} else if (t === "BrickColor") {
		return new BrickColor(((tbl.Name as string) ?? "Medium stone grey") as unknown as number);
	}
	return attributeValue;
}

function setAttribute(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributeName = requestData.attributeName as string;
	const attributeValue = requestData.attributeValue;
	const valueType = requestData.valueType as string | undefined;

	if (!instancePath || !attributeName) {
		return { error: "Instance path and attribute name are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = beginRecording(`Set attribute ${attributeName} on ${instance.Name}`);

	const [success, result] = pcall(() => {
		const value = deserializeValue(attributeValue, valueType);
		instance.SetAttribute(attributeName, value as AttributeValue);

		return {
			success: true, instancePath, attributeName,
			value: attributeValue, message: "Attribute set successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to set attribute: ${result}` };
}

function getAttributes(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const [success, result] = pcall(() => {
		const attributes = instance.GetAttributes();
		const serializedAttributes: Record<string, { value: unknown; type: string }> = {};
		let count = 0;

		for (const [name, value] of pairs(attributes)) {
			serializedAttributes[name as string] = {
				value: serializeValue(value),
				type: typeOf(value),
			};
			count++;
		}

		return { instancePath, attributes: serializedAttributes, count };
	});

	if (success) return result;
	return { error: `Failed to get attributes: ${result}` };
}

function deleteAttribute(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributeName = requestData.attributeName as string;

	if (!instancePath || !attributeName) {
		return { error: "Instance path and attribute name are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = beginRecording(`Delete attribute ${attributeName} from ${instance.Name}`);

	const [success, result] = pcall(() => {
		const existed = instance.GetAttribute(attributeName) !== undefined;
		instance.SetAttribute(attributeName, undefined);

		return {
			success: true, instancePath, attributeName, existed,
			message: existed ? "Attribute deleted successfully" : "Attribute did not exist",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to delete attribute: ${result}` };
}

function getTags(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const [success, result] = pcall(() => {
		const tags = CollectionService.GetTags(instance);
		return { instancePath, tags, count: tags.size() };
	});

	if (success) return result;
	return { error: `Failed to get tags: ${result}` };
}

function addTag(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const tagName = requestData.tagName as string;

	if (!instancePath || !tagName) {
		return { error: "Instance path and tag name are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = beginRecording(`Add tag ${tagName} to ${instance.Name}`);

	const [success, result] = pcall(() => {
		const alreadyHad = CollectionService.HasTag(instance, tagName);
		CollectionService.AddTag(instance, tagName);

		return {
			success: true, instancePath, tagName, alreadyHad,
			message: alreadyHad ? "Instance already had this tag" : "Tag added successfully",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to add tag: ${result}` };
}

function removeTag(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const tagName = requestData.tagName as string;

	if (!instancePath || !tagName) {
		return { error: "Instance path and tag name are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = beginRecording(`Remove tag ${tagName} from ${instance.Name}`);

	const [success, result] = pcall(() => {
		const hadTag = CollectionService.HasTag(instance, tagName);
		CollectionService.RemoveTag(instance, tagName);

		return {
			success: true, instancePath, tagName, hadTag,
			message: hadTag ? "Tag removed successfully" : "Instance did not have this tag",
		};
	});

	if (success) {
		finishRecording(recordingId, true);
		return result;
	}
	finishRecording(recordingId, false);
	return { error: `Failed to remove tag: ${result}` };
}

function getTagged(requestData: Record<string, unknown>) {
	const tagName = requestData.tagName as string;
	if (!tagName) return { error: "Tag name is required" };

	const [success, result] = pcall(() => {
		const taggedInstances = CollectionService.GetTagged(tagName);
		const instances = taggedInstances.map((instance) => ({
			name: instance.Name,
			className: instance.ClassName,
			path: getInstancePath(instance),
		}));

		return { tagName, instances, count: instances.size() };
	});

	if (success) return result;
	return { error: `Failed to get tagged instances: ${result}` };
}

function getSelection(_requestData: Record<string, unknown>) {
	const selection = Selection.Get();

	if (selection.size() === 0) {
		return { success: true, selection: [], count: 0, message: "No objects selected" };
	}

	const selectedObjects = selection.map((instance: Instance) => ({
		name: instance.Name,
		className: instance.ClassName,
		path: getInstancePath(instance),
		parent: instance.Parent ? getInstancePath(instance.Parent) : undefined,
	}));

	return {
		success: true,
		selection: selectedObjects,
		count: selection.size(),
		message: `${selection.size()} object(s) selected`,
	};
}

function executeLuau(requestData: Record<string, unknown>) {
	const code = requestData.code as string;
	if (!code || code === "") return { error: "Code is required" };

	// Both execution paths (loadstring + ModuleScript-require fallback) run
	// the SAME wrapped source so they return a uniform { ok, value, output }
	// shape. Two problems the wrapper solves at once:
	//
	//   1. pcall(require, m) swallows the real error and returns Roblox's
	//      generic "Requested module experienced an error while loading"
	//      message. Wrapping user code in xpcall INSIDE the IIFE keeps the
	//      ModuleScript itself returning successfully — the real error +
	//      traceback live in the returned table.
	//
	//   2. The ModuleScript path runs in its own environment, so a plugin-
	//      side getfenv print/warn override never reached user prints. A
	//      lexical local print/warn inside the IIFE captures user prints
	//      regardless of which path executes. We also call the real global
	//      print/warn so messages still flow to Studio's output and
	//      LogService.MessageOut (which powers get_runtime_logs).
	//
	// Prints from required sub-modules don't reach this capture (they have
	// their own env) — those go through the runtime log buffer.
	const wrapped = `return ((function()
\tlocal __mcp_output = {}
\tlocal __mcp_real_print = print
\tlocal __mcp_real_warn = warn
\tlocal print = function(...)
\t\t__mcp_real_print(...)
\t\tlocal args = {...}
\t\tlocal parts = table.create(#args)
\t\tfor i, a in ipairs(args) do parts[i] = tostring(a) end
\t\ttable.insert(__mcp_output, table.concat(parts, "\\t"))
\tend
\tlocal warn = function(...)
\t\t__mcp_real_warn(...)
\t\tlocal args = {...}
\t\tlocal parts = table.create(#args)
\t\tfor i, a in ipairs(args) do parts[i] = tostring(a) end
\t\ttable.insert(__mcp_output, "[warn] " .. table.concat(parts, "\\t"))
\tend
\tlocal function __mcp_run()
${code}
\tend
\tlocal ok, errOrValue = xpcall(__mcp_run, debug.traceback)
\treturn { ok = ok, value = errOrValue, output = __mcp_output }
end)())`;

	interface WrapperResult {
		ok?: boolean;
		value?: unknown;
		output?: defined;
	}

	const runViaModuleScript = (): WrapperResult => {
		const m = new Instance("ModuleScript");
		m.Name = "__MCPExecLuauPayload";
		const [okSet, setErr] = pcall(() => {
			(m as unknown as { Source: string }).Source = wrapped;
		});
		if (!okSet) {
			m.Destroy();
			error(`ModuleScript Source set failed: ${tostring(setErr)}`);
		}
		m.Parent = game.GetService("Workspace");
		const [okReq, reqResult] = pcall(() => require(m));
		m.Destroy();
		if (!okReq) {
			let errMsg = tostring(reqResult);
			// pcall(require, m) collapses parse/compile failures into the
			// canned engine string below. Walk LogService backward for the
			// real diagnostic, which was emitted to MessageOut just before.
			if (errMsg === "Requested module experienced an error while loading") {
				// The parser diagnostic is emitted to LogService on the next
				// engine frame, not synchronously with pcall(require). task.wait(0)
				// yields too early; 50ms is enough to let the frame complete and
				// the message land in GetLogHistory.
				task.wait(0.05);
				const hist = LogService.GetLogHistory();
				for (let i = hist.size() - 1; i >= 0; i--) {
					const e = hist[i];
					if (
						e.messageType === Enum.MessageType.MessageError &&
						string.sub(e.message, 1, 31) === "Workspace.__MCPExecLuauPayload:"
					) {
						errMsg = e.message;
						break;
					}
				}
			}
			error(errMsg);
		}
		return reqResult as unknown as WrapperResult;
	};

	const isLoadstringUnavailable = (err: unknown): boolean => {
		const errStr = tostring(err);
		const [matchStart] = string.find(errStr, "not available", 1, true);
		return matchStart !== undefined;
	};

	let [success, result] = pcall(() => {
		const [fn, compileError] = loadstring(wrapped);
		if (!fn) {
			if (isLoadstringUnavailable(compileError)) {
				return runViaModuleScript();
			}
			error(`Compile error: ${compileError}`);
		}
		return fn() as unknown as WrapperResult;
	});

	// loadstring throws (not returns nil) in some plugin contexts when
	// LoadStringEnabled=false. Catch that as a second-chance fallback.
	if (!success && isLoadstringUnavailable(result)) {
		[success, result] = pcall(runViaModuleScript);
	}

	if (!success) {
		// Outer pcall failed - the wrapper itself didn't even run (e.g. compile
		// error in the user code, or ModuleScript setup error). 'result' is the
		// raw error string from pcall.
		return {
			success: false,
			error: tostring(result),
			output: [],
			message: "Code execution failed",
		};
	}

	// Wrapper executed - unpack { ok, value, output }.
	const r = result as unknown as WrapperResult;
	const capturedOutput = r.output as unknown as string[] | undefined;
	const output = capturedOutput !== undefined ? capturedOutput : ([] as string[]);
	if (r.ok === true) {
		return {
			success: true,
			returnValue: r.value !== undefined ? tostring(r.value) : undefined,
			output,
			message: "Code executed successfully",
		};
	}
	return {
		success: false,
		error: r.value !== undefined ? tostring(r.value) : "(unknown error)",
		output,
		message: "Code execution failed",
	};
}

function undo(_requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Undo();
		return {
			success: true,
			message: "Undo executed successfully",
		};
	});

	if (success) return result;
	return { error: `Failed to undo: ${result}` };
}

function redo(_requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Redo();
		return {
			success: true,
			message: "Redo executed successfully",
		};
	});

	if (success) return result;
	return { error: `Failed to redo: ${result}` };
}

function bulkSetAttributes(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const attributes = requestData.attributes as Record<string, unknown>;

	if (!instancePath || !attributes) {
		return { error: "Instance path and attributes are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const recordingId = beginRecording(`Bulk set attributes on ${instance.Name}`);

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const [name, rawValue] of pairs(attributes)) {
		const attrName = name as string;
		const [ok, err] = pcall(() => {
			const value = deserializeValue(rawValue);
			instance.SetAttribute(attrName, value as AttributeValue);
		});

		if (ok) {
			successCount++;
			results.push({ attributeName: attrName, success: true });
		} else {
			failureCount++;
			results.push({ attributeName: attrName, success: false, error: tostring(err) });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		instancePath,
		results,
		summary: { total: successCount + failureCount, succeeded: successCount, failed: failureCount },
	};
}

export = {
	setAttribute,
	getAttributes,
	deleteAttribute,
	getTags,
	addTag,
	removeTag,
	getTagged,
	getSelection,
	executeLuau,
	undo,
	redo,
	bulkSetAttributes,
};
