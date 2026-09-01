const ChangeHistoryService = game.GetService("ChangeHistoryService");

type RecordingId = string | undefined;

function beginRecording(actionName: string): RecordingId {
	// Callers inside the plugin pass a bare action ("Create Part"); a caller-supplied
	// undoLabel often already carries the prefix, because that is how the waypoints
	// read in Studio. Prefixing that again produced "MCP: MCP: ...".
	const label = actionName.sub(1, 5) === "MCP: " ? actionName : `MCP: ${actionName}`;
	const [success, result] = pcall(() => ChangeHistoryService.TryBeginRecording(label));
	if (success) {
		return result as RecordingId;
	}
	return undefined;
}

function finishRecording(recordingId: RecordingId, shouldCommit: boolean) {
	if (recordingId === undefined) return;

	const operation = shouldCommit
		? Enum.FinishRecordingOperation.Commit
		: Enum.FinishRecordingOperation.Cancel;

	pcall(() => {
		ChangeHistoryService.FinishRecording(recordingId, operation);
	});
}

export = {
	beginRecording,
	finishRecording,
};
