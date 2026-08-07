import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath, convertPropertyValue } = Utils;
const { beginRecording, finishRecording } = Recording;

type ProcessedCreateResult =
	| {
		instance: Instance;
		className: string;
		parentPath: string;
		propertyErrors?: Record<string, unknown>[];
	}
	| {
		error: string;
		className?: string;
		parentPath?: string;
	};

/**
 * Assign `properties`, collecting per-property failures instead of discarding
 * them. Both create paths wrapped this in a bare `pcall(...)` whose result was
 * thrown away, so create_object answered "Object created successfully" while
 * every property the engine refused — a `{x, y, z}` table where a Vector3 was
 * expected, say — was dropped without a trace, and the caller believed it had
 * positioned and sized the instance.
 */
function applyProperties(
	instance: Instance,
	properties: Record<string, unknown>,
): { failures: Record<string, unknown>[]; total: number } {
	const failures: Record<string, unknown>[] = [];
	let total = 0;
	for (const [propertyName, propertyValue] of pairs(properties)) {
		total++;
		const [ok, err] = pcall(() => {
			const converted = convertPropertyValue(instance, propertyName as string, propertyValue);
			(instance as unknown as { [key: string]: unknown })[propertyName as string] =
				converted !== undefined ? converted : propertyValue;
		});
		if (!ok) failures.push({ property: propertyName, error: tostring(err) });
	}
	return { failures, total };
}

/**
 * Remove an instance so that Studio's undo can bring it back.
 *
 * `Destroy()` tears the instance down irreversibly — it locks Parent and marks
 * the object for collection — so ChangeHistoryService has nothing left to
 * restore. delete_object wrapped Destroy in a recording, which made `undo`
 * report "Undo executed successfully" while the object stayed gone; undoing a
 * *creation* worked, so the plumbing looked fine and only deletes were lost.
 * Unparenting is what Studio's own Delete does, and it undoes cleanly (verified
 * live: unparent restores, Destroy does not).
 *
 * Safe here because these handlers only ever run in the edit DataModel, where
 * scripts are not running, so the connections `Destroy()` would have severed
 * are not live to begin with.
 */
function removeInstance(instance: Instance): void {
	instance.Parent = undefined;
}

type ProcessedBatchResult = {
	results: Record<string, unknown>[];
	successCount: number;
	failureCount: number;
};

/**
 * A row carrying `propertyErrors` is still counted a success, because the
 * instance really was created — but that left `{succeeded: 4, failed: 0}` next
 * to rows whose Color and Material the engine had rejected, and a caller
 * reading only the summary has no reason to look further. Verified live:
 * mass_create_objects reported four successes for a batch in which two
 * properties never applied.
 */
function countPropertyErrorRows(results: Record<string, unknown>[]): number {
	let count = 0;
	for (const row of results) {
		const errors = row.propertyErrors as defined[] | undefined;
		if (errors && errors.size() > 0) count++;
	}
	return count;
}

function processObjectEntries(
	objects: Record<string, unknown>[],
	createFn: (objData: Record<string, unknown>) => ProcessedCreateResult,
): ProcessedBatchResult {
	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	const [loopSuccess, loopError] = pcall(() => {
		for (const entry of objects) {
			if (!typeIs(entry, "table")) {
				failureCount++;
				results.push({ success: false, error: "Each object entry must be a table" });
				continue;
			}

			const objData = entry as Record<string, unknown>;
			const className = objData.className as string;
			const parentPath = objData.parent as string;

			if (!className || !parentPath) {
				failureCount++;
				results.push({ success: false, error: "Class name and parent are required" });
				continue;
			}

			const [entrySuccess, entryResult] = pcall(() => createFn(objData));
			if (!entrySuccess) {
				failureCount++;
				results.push({ success: false, className, parent: parentPath, error: tostring(entryResult) });
				continue;
			}

			if ("instance" in entryResult) {
				successCount++;
				const entry: Record<string, unknown> = {
					success: true,
					className: entryResult.className,
					parent: entryResult.parentPath,
					instancePath: getInstancePath(entryResult.instance),
					name: entryResult.instance.Name,
				};
				if (entryResult.propertyErrors && entryResult.propertyErrors.size() > 0) {
					entry.propertyErrors = entryResult.propertyErrors;
				}
				results.push(entry);
			} else {
				failureCount++;
				results.push({
					success: false,
					className: entryResult.className ?? className,
					parent: entryResult.parentPath ?? parentPath,
					error: entryResult.error,
				});
			}
		}
	});

	if (!loopSuccess) {
		failureCount++;
		results.push({ success: false, error: `Unexpected mass create failure: ${tostring(loopError)}` });
	}

	return { results, successCount, failureCount };
}

function createObject(requestData: Record<string, unknown>) {
	const className = requestData.className as string;
	const parentPath = requestData.parent as string;
	const name = requestData.name as string | undefined;
	const properties = (requestData.properties as Record<string, unknown>) ?? {};

	if (!className || !parentPath) {
		return { error: "Class name and parent are required" };
	}

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent instance not found: ${parentPath}` };
	const recordingId = beginRecording(`Create ${className}`);

	let propertyErrors: Record<string, unknown>[] = [];
	let propertyCount = 0;
	const [success, newInstance] = pcall(() => {
		const instance = new Instance(className as keyof CreatableInstances);
		if (name) instance.Name = name;

		const applied = applyProperties(instance, properties);
		propertyErrors = applied.failures;
		propertyCount = applied.total;

		instance.Parent = parentInstance;
		return instance;
	});

	if (success && newInstance) {
		finishRecording(recordingId, true);
		const result: Record<string, unknown> = {
			success: true,
			className,
			parent: parentPath,
			instancePath: getInstancePath(newInstance as Instance),
			name: (newInstance as Instance).Name,
			message: "Object created successfully",
		};
		if (propertyErrors.size() > 0) {
			result.propertyErrors = propertyErrors;
			result.message = `Object created, but ${propertyErrors.size()} of ${propertyCount} properties could not be applied — see propertyErrors`;
		}
		return result;
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to create object: ${newInstance}`, className, parent: parentPath };
	}
}

function deleteObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (instance === game) return { error: "Cannot delete the game instance" };
	const recordingId = beginRecording(`Delete ${instance.ClassName} (${instance.Name})`);

	const [success, result] = pcall(() => {
		removeInstance(instance);
		return true;
	});

	if (success) {
		finishRecording(recordingId, true);
		return { success: true, instancePath, message: "Object deleted successfully" };
	} else {
		finishRecording(recordingId, false);
		return { error: `Failed to delete object: ${result}`, instancePath };
	}
}

function massDeleteObjects(requestData: Record<string, unknown>) {
	const paths = requestData.paths as string[];
	if (!paths || !typeIs(paths, "table") || (paths as defined[]).size() === 0) {
		return { error: "Paths array is required" };
	}

	// Validate the whole batch before opening a recording. getInstanceByPath calls
	// path.gsub, which throws on a non-string — and thrown from inside the loop it
	// would escape before finishRecording, leaving the change-history recording
	// open and the already-removed items stranded in a half-applied batch.
	for (const path of paths) {
		if (!typeIs(path, "string") || (path as string) === "") {
			return { error: "Every entry in paths must be a non-empty instance path string" };
		}
	}

	// One recording for the whole batch, so a single Ctrl+Z puts everything back
	// rather than making the user undo N times.
	const recordingId = beginRecording(`Delete ${(paths as defined[]).size()} objects`);

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const path of paths) {
		const [resolved, instance] = pcall(() => getInstanceByPath(path));
		if (!resolved) {
			failureCount++;
			results.push({ path, success: false, error: tostring(instance) });
			continue;
		}
		if (!instance) {
			failureCount++;
			results.push({ path, success: false, error: `Instance not found: ${path}` });
			continue;
		}
		if (instance === game) {
			failureCount++;
			results.push({ path, success: false, error: "Cannot delete the game instance" });
			continue;
		}

		const [ok, err] = pcall(() => removeInstance(instance));
		if (ok) {
			successCount++;
			results.push({ path, success: true, className: instance.ClassName, name: instance.Name });
		} else {
			failureCount++;
			results.push({ path, success: false, error: tostring(err) });
		}
	}

	finishRecording(recordingId, successCount > 0);
	return {
		results,
		summary: { total: (paths as defined[]).size(), succeeded: successCount, failed: failureCount },
	};
}

function massCreateObjects(requestData: Record<string, unknown>) {
	const objects = requestData.objects as Record<string, unknown>[];
	if (!objects || !typeIs(objects, "table") || (objects as defined[]).size() === 0) {
		return { error: "Objects array is required" };
	}

	const recordingId = beginRecording("Mass create objects");

	const { results, successCount, failureCount } = processObjectEntries(objects, (objData) => {
		const className = objData.className as string;
		const parentPath = objData.parent as string;
		const name = objData.name as string | undefined;
		const properties = (objData.properties as Record<string, unknown>) ?? {};
		const parentInstance = getInstanceByPath(parentPath);
		if (!parentInstance) {
			return { error: "Parent instance not found", className, parentPath };
		}

		let propertyErrors: Record<string, unknown>[] = [];
		const [success, newInstance] = pcall(() => {
			const instance = new Instance(className as keyof CreatableInstances);
			if (name) instance.Name = name;

			propertyErrors = applyProperties(instance, properties).failures;

			instance.Parent = parentInstance;
			return instance;
		});

		if (!success || !newInstance) {
			return { error: tostring(newInstance), className, parentPath };
		}

		return { instance: newInstance as Instance, className, parentPath, propertyErrors };
	});

	finishRecording(recordingId, successCount > 0);
	return {
		results,
		summary: {
			total: (objects as defined[]).size(),
			succeeded: successCount,
			failed: failureCount,
			withPropertyErrors: countPropertyErrorRows(results),
		},
	};
}



function performSmartDuplicate(requestData: Record<string, unknown>, useRecording = true) {
	const instancePath = requestData.instancePath as string;
	const count = requestData.count as number;
	const options = (requestData.options as Record<string, unknown>) ?? {};

	if (!instancePath || !count || count < 1) {
		return { error: "Instance path and count > 0 are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const recordingId = useRecording ? beginRecording(`Smart duplicate ${instance.Name}`) : undefined;

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (let i = 1; i <= count; i++) {
		// Declared outside the pcall so a failed variation survives into the result
		// instead of vanishing with the closure — same reason createObject does it.
		let variationErrors: Record<string, unknown>[] = [];
		let variationCount = 0;
		const [success, newInstance] = pcall(() => {
			const clone = instance.Clone();

			if (options.namePattern) {
				clone.Name = (options.namePattern as string).gsub("{n}", tostring(i))[0];
			} else {
				clone.Name = instance.Name + i;
			}

			if (options.positionOffset && clone.IsA("BasePart")) {
				const offset = options.positionOffset as number[];
				const currentPos = clone.Position;
				clone.Position = new Vector3(
					currentPos.X + ((offset[0] ?? 0) as number) * i,
					currentPos.Y + ((offset[1] ?? 0) as number) * i,
					currentPos.Z + ((offset[2] ?? 0) as number) * i,
				);
			}

			if (options.rotationOffset && clone.IsA("BasePart")) {
				const offset = options.rotationOffset as number[];
				clone.CFrame = clone.CFrame.mul(CFrame.Angles(
					math.rad(((offset[0] ?? 0) as number) * i),
					math.rad(((offset[1] ?? 0) as number) * i),
					math.rad(((offset[2] ?? 0) as number) * i),
				));
			}

			if (options.scaleOffset && clone.IsA("BasePart")) {
				const offset = options.scaleOffset as number[];
				const currentSize = clone.Size;
				clone.Size = new Vector3(
					currentSize.X * (((offset[0] ?? 1) as number) ** i),
					currentSize.Y * (((offset[1] ?? 1) as number) ** i),
					currentSize.Z * (((offset[2] ?? 1) as number) ** i),
				);
			}

			if (options.propertyVariations) {
				// Was: a raw assignment inside a bare pcall. That skipped
				// convertPropertyValue, so the documented forms — Color as
				// [255, 0, 0], Position as {x,y,z} — arrived as Lua tables the
				// engine rejects, and the discarded pcall meant the tool reported
				// "succeeded: 2, failed: 0" with no variation applied at all.
				// applyProperties (used by create_object) converts and reports.
				const variation: Record<string, unknown> = {};
				for (const [propName, values] of pairs(options.propertyVariations as Record<string, unknown[]>)) {
					if (values && (values as defined[]).size() > 0) {
						const valueIndex = ((i - 1) % (values as defined[]).size());
						variation[propName as string] = (values as unknown[])[valueIndex];
					}
				}
				const applied = applyProperties(clone, variation);
				variationErrors = applied.failures;
				variationCount = applied.total;
			}

			const targetParents = options.targetParents as string[] | undefined;
			if (targetParents && targetParents[i - 1]) {
				const targetParent = getInstanceByPath(targetParents[i - 1]);
				clone.Parent = targetParent ?? instance.Parent;
			} else {
				clone.Parent = instance.Parent;
			}

			return clone;
		});

		if (success && newInstance) {
			successCount++;
			const row: Record<string, unknown> = {
				success: true,
				instancePath: getInstancePath(newInstance as Instance),
				name: (newInstance as Instance).Name,
				index: i,
			};
			if (variationErrors.size() > 0) {
				row.propertyErrors = variationErrors;
				row.message = `Duplicate created, but ${variationErrors.size()} of ${variationCount} property variations could not be applied — see propertyErrors`;
			}
			results.push(row);
		} else {
			failureCount++;
			results.push({ success: false, index: i, error: tostring(newInstance) });
		}
	}

	finishRecording(recordingId, successCount > 0);

	return {
		results,
		summary: {
			total: count,
			succeeded: successCount,
			failed: failureCount,
			withPropertyErrors: countPropertyErrorRows(results),
		},
		sourceInstance: instancePath,
	};
}

function smartDuplicate(requestData: Record<string, unknown>) {
	return performSmartDuplicate(requestData, true);
}

function massDuplicate(requestData: Record<string, unknown>) {
	const duplications = requestData.duplications as Record<string, unknown>[];
	if (!duplications || !typeIs(duplications, "table") || (duplications as defined[]).size() === 0) {
		return { error: "Duplications array is required" };
	}

	const allResults: Record<string, unknown>[] = [];
	let totalSuccess = 0;
	let totalFailures = 0;
	let totalPropertyErrorRows = 0;
	const recordingId = beginRecording("Mass duplicate operations");

	for (const duplication of duplications) {
		const result = performSmartDuplicate(duplication, false) as {
			summary?: { succeeded: number; failed: number; withPropertyErrors?: number };
		};
		allResults.push(result as unknown as Record<string, unknown>);
		if (result.summary) {
			totalSuccess += result.summary.succeeded;
			totalFailures += result.summary.failed;
			// Nested one level down: allResults holds whole sub-results, not rows,
			// so the count has to come from each sub-summary rather than a scan.
			totalPropertyErrorRows += result.summary.withPropertyErrors ?? 0;
		}
	}

	finishRecording(recordingId, totalSuccess > 0);

	return {
		results: allResults,
		summary: {
			total: totalSuccess + totalFailures,
			succeeded: totalSuccess,
			failed: totalFailures,
			withPropertyErrors: totalPropertyErrorRows,
		},
	};
}

function cloneObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const targetParentPath = requestData.targetParentPath as string;

	if (!instancePath || !targetParentPath) {
		return { error: "Instance path and target parent path are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const targetParent = getInstanceByPath(targetParentPath);
	if (!targetParent) return { error: `Target parent not found: ${targetParentPath}` };

	const recordingId = beginRecording(`Clone ${instance.Name}`);

	const [success, clone] = pcall(() => {
		const cloned = instance.Clone();
		cloned.Parent = targetParent;
		return cloned;
	});

	if (success && clone) {
		finishRecording(recordingId, true);
		return {
			success: true,
			instancePath: getInstancePath(clone as Instance),
			name: (clone as Instance).Name,
			className: (clone as Instance).ClassName,
			parent: targetParentPath,
			message: "Object cloned successfully",
		};
	}
	finishRecording(recordingId, false);
	return { error: `Failed to clone object: ${clone}` };
}

export = {
	createObject,
	deleteObject,
	massCreateObjects,
	massDeleteObjects,
	smartDuplicate,
	massDuplicate,
	cloneObject,
};
