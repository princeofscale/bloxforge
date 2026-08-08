const ScriptEditorService = game.GetService("ScriptEditorService");

function safeCall<T>(func: (...args: never[]) => T, ...args: never[]): T | undefined {
	const [success, result] = pcall(func, ...args);
	if (success) {
		return result;
	} else {
		warn(`MCP Plugin Error: ${result}`);
		return undefined;
	}
}

function getInstancePath(instance: Instance): string {
	if (!instance || instance === game) {
		return "game";
	}

	const pathParts: string[] = [];
	let current: Instance | undefined = instance;

	while (current && current !== game) {
		pathParts.unshift(current.Name);
		current = current.Parent as Instance | undefined;
	}

	return `game.${pathParts.join(".")}`;
}

function getInstanceByPath(path: string): Instance | undefined {
	if (path === "game" || path === "") {
		return game;
	}

	const cleaned = path.gsub("^game%.", "")[0];
	const parts: string[] = [];
	for (const [part] of cleaned.gmatch("[^%.]+")) {
		parts.push(part as string);
	}

	let current: Instance | undefined = game;
	for (const part of parts) {
		if (!current) return undefined;
		current = current.FindFirstChild(part);
	}

	return current;
}

function splitLines(source: string): LuaTuple<[string[], boolean]> {
	const normalized = ((source ?? "") as string).gsub("\r\n", "\n")[0].gsub("\r", "\n")[0];
	const endsWithNewline = normalized.sub(-1) === "\n";

	const lines: string[] = [];
	let start = 1;

	while (true) {
		const [newlinePos] = string.find(normalized, "\n", start, true);
		if (newlinePos !== undefined) {
			lines.push(string.sub(normalized, start, newlinePos - 1));
			start = newlinePos + 1;
		} else {
			const remainder = string.sub(normalized, start);
			if (remainder !== "" || !endsWithNewline) {
				lines.push(remainder);
			}
			break;
		}
	}

	if (lines.size() === 0) {
		lines.push("");
	}

	return [lines, endsWithNewline] as unknown as LuaTuple<[string[], boolean]>;
}

function joinLines(lines: string[], hadTrailingNewline: boolean): string {
	let source = lines.join("\n");
	if (hadTrailingNewline && source.sub(-1) !== "\n") {
		source += "\n";
	}
	return source;
}

function readScriptSource(instance: LuaSourceContainer): string {
	const [ok, result] = pcall(() => {
		const doc = ScriptEditorService.FindScriptDocument(instance);
		if (doc) {
			return doc.GetText();
		}
		return undefined;
	});
	if (ok && result) {
		return result;
	}
	return (instance as unknown as { Source: string }).Source;
}

/**
 * Read a component under either casing. Only `{X, Y, Z}` / `{R, G, B}` used to
 * be recognized, so the equally natural `{x, y, z}` fell through unconverted and
 * the engine rejected the raw table — "Vector3 expected, got table".
 */
function component(tbl: Record<string, unknown>, upper: string, lower: string): unknown {
	return tbl[upper] !== undefined ? tbl[upper] : tbl[lower];
}

/**
 * Color3 components are 0-1, but callers reach for 0-255 constantly and the
 * engine neither errors nor clamps: Color3.new(255, 80, 40) keeps 255, so the
 * instance simply renders wrong with nothing to indicate why. A component above
 * 1 can only have been meant as 0-255.
 *
 * ponytail: a 0-255 colour whose every component is 0 or 1 (so, near-black)
 * still reads as 0-1. Take an explicit format field if that ever matters.
 */
function toColor3(r: number, g: number, b: number): Color3 {
	if (r > 1 || g > 1 || b > 1) return Color3.fromRGB(r, g, b);
	return new Color3(r, g, b);
}

/**
 * Make a Luau value survive the JSON response encoder.
 *
 * The encoder drops any key whose value is userdata, so a handler that returns
 * a Color3 or an EnumItem verbatim answers `{success = true}` with the value
 * simply absent — which reads as "worked" at the call site. `mass_get_property`
 * did exactly that for Color and Material while Anchored (a boolean) came
 * through fine, and `get_attributes` loses the same way for every attribute
 * type past Vector3/Color3/UDim2/BrickColor: it still reports `type`, so only
 * the value goes missing.
 *
 * Tagged tables keep the components addressable and match what
 * `deserializeValue` reads back. An unhandled type becomes an explicit
 * `unsupported` marker rather than either vanishing or degrading to a bare
 * string that would silently write back as text.
 *
 * ponytail: NumberSequence, ColorSequence and Font take that marker — readable,
 * not writable. Give them real branches here and in `deserializeValue` together
 * when something needs to round-trip one.
 */
function serializeValue(value: unknown): unknown {
	const vType = typeOf(value);

	if (vType === "Vector3") {
		const v = value as Vector3;
		return { X: v.X, Y: v.Y, Z: v.Z, _type: "Vector3" };
	} else if (vType === "Vector2") {
		const v = value as Vector2;
		return { X: v.X, Y: v.Y, _type: "Vector2" };
	} else if (vType === "Color3") {
		const v = value as Color3;
		return { R: v.R, G: v.G, B: v.B, _type: "Color3" };
	} else if (vType === "CFrame") {
		// Position alone was the worst shape in this function: `unsupported` at
		// least admits it lost something, but a CFrame reported as {Position}
		// looks like a complete structured read while half the value — the whole
		// orientation — is gone. Reading a rotated part to copy its placement
		// silently produced an unrotated one.
		//
		// Components is the exact 12-number form `CFrame.new(...)` reconstructs,
		// so the value round-trips. Orientation (degrees) is what Studio's
		// property panel shows and what a caller reasons about. Position stays
		// for the readers that already destructure it.
		const v = value as CFrame;
		const [rx, ry, rz] = v.ToOrientation();
		const [cx, cy, cz, r00, r01, r02, r10, r11, r12, r20, r21, r22] = v.GetComponents();
		return {
			Position: { X: v.Position.X, Y: v.Position.Y, Z: v.Position.Z },
			Orientation: { X: math.deg(rx), Y: math.deg(ry), Z: math.deg(rz) },
			Components: [cx, cy, cz, r00, r01, r02, r10, r11, r12, r20, r21, r22],
			_type: "CFrame",
		};
	} else if (vType === "UDim2") {
		const v = value as UDim2;
		return {
			X: { Scale: v.X.Scale, Offset: v.X.Offset },
			Y: { Scale: v.Y.Scale, Offset: v.Y.Offset },
			_type: "UDim2",
		};
	} else if (vType === "UDim") {
		const v = value as UDim;
		return { Scale: v.Scale, Offset: v.Offset, _type: "UDim" };
	} else if (vType === "NumberRange") {
		const v = value as NumberRange;
		return { Min: v.Min, Max: v.Max, _type: "NumberRange" };
	} else if (vType === "Rect") {
		const v = value as Rect;
		return { MinX: v.Min.X, MinY: v.Min.Y, MaxX: v.Max.X, MaxY: v.Max.Y, _type: "Rect" };
	} else if (vType === "BrickColor") {
		const v = value as BrickColor;
		return { Name: v.Name, _type: "BrickColor" };
	} else if (vType === "EnumItem") {
		const v = value as EnumItem;
		return { Name: v.Name, Value: v.Value, EnumType: tostring(v.EnumType), _type: "EnumItem" };
	} else if (vType === "Instance") {
		return { Path: getInstancePath(value as Instance), _type: "Instance" };
	}

	// Everything the encoder can already represent passes through untouched, so
	// a boolean stays a boolean rather than becoming "true".
	if (
		vType === "string" ||
		vType === "number" ||
		vType === "boolean" ||
		vType === "nil" ||
		vType === "table"
	) {
		return value;
	}

	return { TypeName: vType, Text: tostring(value), _type: "unsupported" };
}

/**
 * Rebuild a CFrame from what `serializeValue` emits, so a read value can be
 * written straight back. `Components` is preferred because it is exact;
 * `Position` + `Orientation` is accepted so a caller can hand-write one.
 * Returns undefined when the table is not a CFrame shape, leaving the caller's
 * other branches to run.
 */
function cframeFromTable(tbl: Record<string, unknown>): CFrame | undefined {
	const comps = tbl.Components as number[] | undefined;
	if (typeIs(comps, "table") && (comps as defined[]).size() >= 12) {
		return new CFrame(
			comps[0], comps[1], comps[2],
			comps[3], comps[4], comps[5],
			comps[6], comps[7], comps[8],
			comps[9], comps[10], comps[11],
		);
	}

	const pos = tbl.Position as Record<string, number> | undefined;
	if (!typeIs(pos, "table")) return undefined;
	const base = new CFrame(pos.X ?? 0, pos.Y ?? 0, pos.Z ?? 0);

	const ori = tbl.Orientation as Record<string, number> | undefined;
	if (!typeIs(ori, "table")) return base;
	return base.mul(CFrame.fromOrientation(math.rad(ori.X ?? 0), math.rad(ori.Y ?? 0), math.rad(ori.Z ?? 0)));
}

function convertPropertyValue(instance: Instance, propertyName: string, propertyValue: unknown): unknown {
	if (propertyValue === undefined) return undefined;

	const inst = instance as unknown as Record<string, unknown>;

	if (typeIs(propertyValue, "table")) {
		const arr = propertyValue as unknown[];
		const tbl = propertyValue as Record<string, unknown>;

		// Before the shape guesses below. Two ways in: the caller tagged it, or
		// the property itself is already a CFrame — the same "ask the current
		// value" trick the Vector3/Color3 branches below use, so a hand-written
		// { Position, Orientation } works without knowing about `_type`.
		if (tbl._type === "CFrame") {
			const cf = cframeFromTable(tbl);
			if (cf !== undefined) return cf;
		} else if (tbl.Components !== undefined || tbl.Position !== undefined) {
			const [ok, currentVal] = pcall(() => inst[propertyName]);
			if (ok && typeOf(currentVal) === "CFrame") {
				const cf = cframeFromTable(tbl);
				if (cf !== undefined) return cf;
			}
		}

		if (typeIs(arr, "table") && (arr as defined[]).size() > 0) {
			const len = (arr as defined[]).size();

			if (len === 3) {
				const prop = propertyName.lower();
				if (
					prop === "position" || prop === "size" || prop === "orientation" ||
					prop === "velocity" || prop === "angularvelocity"
				) {
					return new Vector3(
						(arr[0] as number) ?? 0,
						(arr[1] as number) ?? 0,
						(arr[2] as number) ?? 0,
					);
				} else if (prop === "color" || prop === "color3") {
					return toColor3(
						(arr[0] as number) ?? 0,
						(arr[1] as number) ?? 0,
						(arr[2] as number) ?? 0,
					);
				} else {
					const [success, currentVal] = pcall(() => inst[propertyName]);
					if (success) {
						if (typeOf(currentVal) === "Vector3") {
							return new Vector3(
								(arr[0] as number) ?? 0,
								(arr[1] as number) ?? 0,
								(arr[2] as number) ?? 0,
							);
						} else if (typeOf(currentVal) === "Color3") {
							return toColor3(
								(arr[0] as number) ?? 0,
								(arr[1] as number) ?? 0,
								(arr[2] as number) ?? 0,
							);
						}
					}
				}
			} else if (len === 2) {
				const [success, currentVal] = pcall(() => inst[propertyName]);
				if (success && typeOf(currentVal) === "Vector2") {
					return new Vector2((arr[0] as number) ?? 0, (arr[1] as number) ?? 0);
				}
			} else if (len === 4) {
				const [success, currentVal] = pcall(() => inst[propertyName]);
				if (success && typeOf(currentVal) === "UDim2") {
					return new UDim2(
						(arr[0] as number) ?? 0,
						(arr[1] as number) ?? 0,
						(arr[2] as number) ?? 0,
						(arr[3] as number) ?? 0,
					);
				}
			}
		}

		const x = component(tbl, "X", "x");
		const y = component(tbl, "Y", "y");
		const z = component(tbl, "Z", "z");
		if (x !== undefined || y !== undefined || z !== undefined) {

			if (typeIs(x, "table") && typeIs(y, "table")) {
				const xTbl = x as unknown as Record<string, unknown>;
				const yTbl = y as unknown as Record<string, unknown>;
				return new UDim2(
					(component(xTbl, "Scale", "scale") as number) ?? 0, (component(xTbl, "Offset", "offset") as number) ?? 0,
					(component(yTbl, "Scale", "scale") as number) ?? 0, (component(yTbl, "Offset", "offset") as number) ?? 0,
				);
			}
			return new Vector3(
				(x as number) ?? 0,
				(y as number) ?? 0,
				(z as number) ?? 0,
			);
		}

		const r = component(tbl, "R", "r");
		const g = component(tbl, "G", "g");
		const b = component(tbl, "B", "b");
		if (r !== undefined || g !== undefined || b !== undefined) {
			return toColor3(
				(r as number) ?? 0,
				(g as number) ?? 0,
				(b as number) ?? 0,
			);
		}
	}

	if (typeIs(propertyValue, "string")) {
		const [success, currentVal] = pcall(() => inst[propertyName]);
		if (success && typeOf(currentVal) === "EnumItem") {
			const enumItem = currentVal as EnumItem;
			const enumTypeName = tostring(enumItem.EnumType);
			const [enumSuccess, enumVal] = pcall(() => {
				return (Enum as unknown as Record<string, Record<string, EnumItem>>)[enumTypeName][propertyValue];
			});
			if (enumSuccess && enumVal) return enumVal;
		}
		if (propertyName === "BrickColor") {
			return new BrickColor(propertyValue as unknown as number);
		}
		if (propertyValue === "true") return true;
		if (propertyValue === "false") return false;
	}

	return propertyValue;
}

function evaluateFormula(
	formula: string,
	variables: Record<string, unknown> | undefined,
	instance: Instance | undefined,
	index: number,
): LuaTuple<[number, string | undefined]> {
	let value = formula;

	value = value.gsub("index", tostring(index))[0];

	if (instance && instance.IsA("BasePart")) {
		const pos = instance.Position;
		const sz = instance.Size;
		value = value.gsub("Position%.X", tostring(pos.X))[0];
		value = value.gsub("Position%.Y", tostring(pos.Y))[0];
		value = value.gsub("Position%.Z", tostring(pos.Z))[0];
		value = value.gsub("Size%.X", tostring(sz.X))[0];
		value = value.gsub("Size%.Y", tostring(sz.Y))[0];
		value = value.gsub("Size%.Z", tostring(sz.Z))[0];
		value = value.gsub("magnitude", tostring(pos.Magnitude))[0];
	}

	if (variables) {
		for (const [k, v] of pairs(variables)) {
			value = value.gsub(k as string, tostring(v))[0];
		}
	}

	value = value.gsub("sin%(([%d%.%-]+)%)", (x: string) => tostring(math.sin(tonumber(x) ?? 0)))[0];
	value = value.gsub("cos%(([%d%.%-]+)%)", (x: string) => tostring(math.cos(tonumber(x) ?? 0)))[0];
	value = value.gsub("sqrt%(([%d%.%-]+)%)", (x: string) => tostring(math.sqrt(tonumber(x) ?? 0)))[0];
	value = value.gsub("abs%(([%d%.%-]+)%)", (x: string) => tostring(math.abs(tonumber(x) ?? 0)))[0];
	value = value.gsub("floor%(([%d%.%-]+)%)", (x: string) => tostring(math.floor(tonumber(x) ?? 0)))[0];
	value = value.gsub("ceil%(([%d%.%-]+)%)", (x: string) => tostring(math.ceil(tonumber(x) ?? 0)))[0];

	const directResult = tonumber(value);
	if (directResult !== undefined) {
		return [directResult, undefined] as unknown as LuaTuple<[number, string | undefined]>;
	}

	const [success, evalResult] = pcall(() => {
		const num = tonumber(value);
		if (num !== undefined) return num;

		{
			const [a, b] = value.match("^([%d%.%-]+)%s*%*%s*([%d%.%-]+)$") as LuaTuple<[string?, string?]>;
			if (a && b) return (tonumber(a) ?? 0) * (tonumber(b) ?? 0);
		}

		{
			const [a, b] = value.match("^([%d%.%-]+)%s*%+%s*([%d%.%-]+)$") as LuaTuple<[string?, string?]>;
			if (a && b) return (tonumber(a) ?? 0) + (tonumber(b) ?? 0);
		}

		{
			const [a, b] = value.match("^([%d%.%-]+)%s*%-%s*([%d%.%-]+)$") as LuaTuple<[string?, string?]>;
			if (a && b) return (tonumber(a) ?? 0) - (tonumber(b) ?? 0);
		}

		{
			const [a, b] = value.match("^([%d%.%-]+)%s*/%s*([%d%.%-]+)$") as LuaTuple<[string?, string?]>;
			if (a && b) {
				const divisor = tonumber(b) ?? 1;
				if (divisor !== 0) return (tonumber(a) ?? 0) / divisor;
			}
		}

		error(`Unsupported formula pattern: ${value}`, 0);
	});

	if (success && typeIs(evalResult, "number")) {
		return [evalResult, undefined] as unknown as LuaTuple<[number, string | undefined]>;
	} else {
		return [index, "Complex formulas not supported - using index value"] as unknown as LuaTuple<[number, string | undefined]>;
	}
}

function compareVersions(v1: string, v2: string): number {
	function parseVersion(v: string): number[] {
		const parts: number[] = [];
		for (const [num] of string.gmatch(v, "%d+")) {
			parts.push(tonumber(num) ?? 0);
		}
		return parts;
	}

	const p1 = parseVersion(v1);
	const p2 = parseVersion(v2);
	const maxLen = math.max(p1.size(), p2.size());
	for (let i = 0; i < maxLen; i++) {
		const n1 = p1[i] ?? 0;
		const n2 = p2[i] ?? 0;
		if (n1 < n2) return -1;
		if (n1 > n2) return 1;
	}
	return 0;
}

export = {
	safeCall,
	getInstancePath,
	getInstanceByPath,
	splitLines,
	joinLines,
	readScriptSource,
	serializeValue,
	convertPropertyValue,
	cframeFromTable,
	evaluateFormula,
	compareVersions,
};
