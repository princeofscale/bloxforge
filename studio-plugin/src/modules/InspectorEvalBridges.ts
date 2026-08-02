// Inspector builds redirect EvalBridges imports here so arbitrary runtime
// execution helpers are not packaged into the read-only plugin.
export function cleanupLegacyEditBridges(): void {}

export function ensureRuntimeBridgeInstalled(): { installed: true } {
	return { installed: true };
}
