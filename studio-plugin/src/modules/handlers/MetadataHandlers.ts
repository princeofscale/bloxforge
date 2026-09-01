import { CollectionService } from "@rbxts/services";
import Utils from "../Utils";
import Recording from "../Recording";
import LuauExec from "../LuauExec";

const ChangeHistoryService = game.GetService("ChangeHistoryService");
const Selection = game.GetService("Selection");
const Workspace = game.GetService("Workspace");

const { getInstancePath, getInstanceByPath, serializeValue, cframeFromTable } = Utils;
const { beginRecording, finishRecording } = Recording;

function deserializeValue(attributeValue: unknown, valueType?: string): unknown {
	// Scalars used to return unchanged, so `valueType` — advertised as "type hint
	// if needed" — did nothing in the one case that needs a hint: a client that
	// sends 42 as the string "42" stored a *string* attribute, silently, because
	// attributes are strongly typed. Honour the hint for scalars too.
	if (!typeIs(attributeValue, "table")) {
		if (typeIs(attributeValue, "string")) {
			if (valueType === "number") return tonumber(attributeValue) ?? attributeValue;
			if (valueType === "boolean") return attributeValue === "true";
		}
		return attributeValue;
	}

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
	} else if (t === "UDim") {
		return new UDim((tbl.Scale as number) ?? 0, (tbl.Offset as number) ?? 0);
	} else if (t === "Vector2") {
		return new Vector2((tbl.X as number) ?? 0, (tbl.Y as number) ?? 0);
	} else if (t === "NumberRange") {
		const min = (tbl.Min as number) ?? 0;
		return new NumberRange(min, (tbl.Max as number) ?? min);
	} else if (t === "Rect") {
		return new Rect(
			(tbl.MinX as number) ?? 0,
			(tbl.MinY as number) ?? 0,
			(tbl.MaxX as number) ?? 0,
			(tbl.MaxY as number) ?? 0,
		);
	} else if (t === "BrickColor") {
		return new BrickColor(((tbl.Name as string) ?? "Medium stone grey") as unknown as number);
	} else if (t === "CFrame") {
		// CFrame is a valid attribute type, and serializeValue now emits a full
		// one — without this branch the tagged table fell through and got stored
		// as a table, which the engine rejects.
		const cf = cframeFromTable(tbl);
		if (cf !== undefined) return cf;
	} else if (t === "unsupported") {
		// serializeValue could only render this type as text. Writing the text
		// back would store a string under a name the caller believes still holds
		// a NumberSequence, so refuse instead.
		error(
			`Cannot write back a ${tostring(tbl.TypeName)} value: BloxForge read it as text only. ` +
				"Set it from Luau via execute_luau instead.",
			0,
		);
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

// Writing the selection and framing the camera are the two halves an agent
// needs that reading alone does not give it: Studio's own UI (Explorer,
// property editor, plugin widgets) follows the selection, and a screenshot is
// only useful once the camera is pointed at the thing being changed.
function manageSelection(requestData: Record<string, unknown>) {
	const action = (requestData.action as string) ?? "set";

	if (action === "focus") {
		const path = requestData.path as string;
		if (!typeIs(path, "string") || path === "") {
			return { error: "path is required when action is 'focus'" };
		}
		const instance = getInstanceByPath(path);
		if (!instance) return { error: `Instance not found: ${path}` };

		const camera = Workspace.CurrentCamera;
		if (!camera) return { error: "No CurrentCamera to frame with" };

		// GetBoundingBox exists on Model; a lone BasePart has Size/CFrame. Both
		// reduce to a centre and a radius, which is all the framing needs.
		let center: Vector3;
		let radius: number;
		if (instance.IsA("Model")) {
			const [modelCFrame, modelSize] = instance.GetBoundingBox();
			center = modelCFrame.Position;
			radius = modelSize.Magnitude / 2;
		} else if (instance.IsA("BasePart")) {
			center = instance.Position;
			radius = instance.Size.Magnitude / 2;
		} else {
			return { error: `focus needs a BasePart or Model, got ${instance.ClassName}` };
		}

		for (const [name, value] of [
			["from", requestData.from],
			["angleY", requestData.angleY],
			["padding", requestData.padding],
		] as [string, unknown][]) {
			if (value !== undefined && !typeIs(value, "number")) {
				return { error: `${name} must be a number` };
			}
		}

		const padding = (requestData.padding as number) ?? 1;
		// A zero-size part would put the camera inside itself; keep a floor.
		const distance = math.max(radius, 1) * 3 * math.max(padding, 0.1);
		// Azimuth 0 looks from +X, 90 from +Z, matching the world axes the
		// caller reads off positions. Elevation is clamped short of straight
		// down, where lookAt's up vector degenerates.
		const azimuth = math.rad((requestData.from as number) ?? 45);
		const elevation = math.rad(math.clamp((requestData.angleY as number) ?? 30, -89, 89));
		const horizontal = math.cos(elevation) * distance;
		const eye = center.add(
			new Vector3(math.cos(azimuth) * horizontal, math.sin(elevation) * distance, math.sin(azimuth) * horizontal),
		);

		const [ok, err] = pcall(() => {
			camera.CFrame = CFrame.lookAt(eye, center);
		});
		if (!ok) return { error: `Failed to move the camera: ${tostring(err)}` };

		return {
			success: true,
			action,
			path: getInstancePath(instance),
			center: { x: center.X, y: center.Y, z: center.Z },
			distance,
		};
	}

	if (action !== "set" && action !== "add" && action !== "remove") {
		return { error: `Unknown action '${action}'; expected set, add, remove or focus` };
	}

	const rawPaths = requestData.paths;
	if (!typeIs(rawPaths, "table")) {
		return { error: "paths is required when action is set, add or remove" };
	}
	const paths = rawPaths as string[];

	const resolved: Instance[] = [];
	const notFound: string[] = [];
	for (const path of paths) {
		if (!typeIs(path, "string")) {
			return { error: "paths must contain only instance path strings" };
		}
		const instance = getInstanceByPath(path);
		if (instance) resolved.push(instance);
		else notFound.push(path);
	}
	// A path that does not resolve is a caller mistake, not a partial success:
	// silently selecting the subset that happened to exist is how an agent ends
	// up acting on the wrong objects.
	if (notFound.size() > 0) {
		return { error: `Instances not found: ${notFound.join(", ")}` };
	}

	let nextSelection: Instance[];
	if (action === "set") {
		nextSelection = resolved;
	} else {
		nextSelection = Selection.Get();
		if (action === "add") {
			for (const instance of resolved) {
				if (!nextSelection.includes(instance)) nextSelection.push(instance);
			}
		} else {
			const removing = resolved;
			nextSelection = nextSelection.filter((instance) => !removing.includes(instance));
		}
	}

	const [ok, err] = pcall(() => Selection.Set(nextSelection));
	if (!ok) return { error: `Failed to set the selection: ${tostring(err)}` };

	return {
		success: true,
		action,
		count: nextSelection.size(),
		selection: nextSelection.map((instance) => getInstancePath(instance)),
	};
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
	// All wrapping, print/warn capture, loadstring fallback, JSON-encoding
	// of table returns, and parse-error recovery live in LuauExec so the
	// edit/server (this handler) and the play-client (ClientBroker) take
	// the same code path and produce identical output shapes.
	//
	// Callers that mutate the DataModel declare an undoLabel, which turns the
	// whole script into one Undo waypoint. Reads (world snapshot, fingerprint,
	// syntax check) send none: the recording is opt-in rather than inferred,
	// because a read must not open an empty recording and a runtime peer has
	// no edit history to record into.
	const undoLabel = requestData.undoLabel;
	if (!typeIs(undoLabel, "string") || undoLabel === "") {
		return LuauExec.execute(code);
	}
	const recordingId = beginRecording(undoLabel);
	const result = LuauExec.execute(code);
	// Cancel on failure so a script that died halfway does not leave a
	// committed waypoint the user has to undo separately.
	finishRecording(recordingId, result.success === true);
	return result;
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
	manageSelection,
	executeLuau,
	undo,
	redo,
	bulkSetAttributes,
};
