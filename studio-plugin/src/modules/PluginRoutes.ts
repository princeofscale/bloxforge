import QueryHandlers from "./handlers/QueryHandlers";
import PropertyHandlers from "./handlers/PropertyHandlers";
import InstanceHandlers from "./handlers/InstanceHandlers";
import ScriptHandlers from "./handlers/ScriptHandlers";
import MetadataHandlers from "./handlers/MetadataHandlers";
import TestHandlers from "./handlers/TestHandlers";
import BuildHandlers from "./handlers/BuildHandlers";
import AssetHandlers from "./handlers/AssetHandlers";
import CaptureHandlers from "./handlers/CaptureHandlers";
import InputHandlers from "./handlers/InputHandlers";
import LogHandlers from "./handlers/LogHandlers";
import SerializationHandlers from "./handlers/SerializationHandlers";
import MemoryHandlers from "./handlers/MemoryHandlers";
import SceneAnalysisHandlers from "./handlers/SceneAnalysisHandlers";
import EvalRuntimeHandlers from "./handlers/EvalRuntimeHandlers";
import BreakpointHandlers from "./handlers/BreakpointHandlers";
import ScriptProfilerHandlers from "./handlers/ScriptProfilerHandlers";
import MicroProfilerHandlers from "./handlers/MicroProfilerHandlers";
import JobHandlers from "./handlers/JobHandlers";

export type PluginHandler = (data: Record<string, unknown>) => unknown;

const routes: Record<string, PluginHandler> = {
	"/api/file-tree": QueryHandlers.getFileTree,
	"/api/search-files": QueryHandlers.searchFiles,
	"/api/place-info": QueryHandlers.getPlaceInfo,
	"/api/services": QueryHandlers.getServices,
	"/api/search-objects": QueryHandlers.searchObjects,
	"/api/instance-properties": QueryHandlers.getInstanceProperties,
	"/api/instance-children": QueryHandlers.getInstanceChildren,
	"/api/search-by-property": QueryHandlers.searchByProperty,
	"/api/class-info": QueryHandlers.getClassInfo,
	"/api/project-structure": QueryHandlers.getProjectStructure,
	"/api/grep-scripts": QueryHandlers.grepScripts,
	"/api/get-descendants": QueryHandlers.getDescendants,
	"/api/compare-instances": QueryHandlers.compareInstances,
	"/api/set-property": PropertyHandlers.setProperty,
	"/api/set-properties": PropertyHandlers.setProperties,
	"/api/mass-set-property": PropertyHandlers.massSetProperty,
	"/api/mass-get-property": PropertyHandlers.massGetProperty,
	"/api/create-object": InstanceHandlers.createObject,
	"/api/mass-create-objects": InstanceHandlers.massCreateObjects,
	"/api/mass-create-objects-with-properties": InstanceHandlers.massCreateObjects,
	"/api/delete-object": InstanceHandlers.deleteObject,
	"/api/mass-delete-objects": InstanceHandlers.massDeleteObjects,
	"/api/smart-duplicate": InstanceHandlers.smartDuplicate,
	"/api/mass-duplicate": InstanceHandlers.massDuplicate,
	"/api/clone-object": InstanceHandlers.cloneObject,
	"/api/get-script-source": ScriptHandlers.getScriptSource,
	"/api/read-managed-scripts": ScriptHandlers.readManagedScripts,
	"/api/set-script-source": ScriptHandlers.setScriptSource,
	"/api/edit-script-lines": ScriptHandlers.editScriptLines,
	"/api/insert-script-lines": ScriptHandlers.insertScriptLines,
	"/api/delete-script-lines": ScriptHandlers.deleteScriptLines,
	"/api/set-attribute": MetadataHandlers.setAttribute,
	"/api/get-attributes": MetadataHandlers.getAttributes,
	"/api/delete-attribute": MetadataHandlers.deleteAttribute,
	"/api/get-tags": MetadataHandlers.getTags,
	"/api/add-tag": MetadataHandlers.addTag,
	"/api/remove-tag": MetadataHandlers.removeTag,
	"/api/get-tagged": MetadataHandlers.getTagged,
	"/api/get-selection": MetadataHandlers.getSelection,
	"/api/manage-selection": MetadataHandlers.manageSelection,
	"/api/execute-luau": MetadataHandlers.executeLuau,
	"/api/execute-luau-async": JobHandlers.executeLuauAsync,
	"/api/get-job-status": JobHandlers.getJobStatus,
	"/api/get-job-result": JobHandlers.getJobResult,
	"/api/cancel-job": JobHandlers.cancelJob,
	"/api/eval-runtime": EvalRuntimeHandlers.evalRuntime,
	"/api/undo": MetadataHandlers.undo,
	"/api/redo": MetadataHandlers.redo,
	"/api/bulk-set-attributes": MetadataHandlers.bulkSetAttributes,
	"/api/start-playtest": TestHandlers.startPlaytest,
	"/api/stop-playtest": TestHandlers.stopPlaytest,
	"/api/multiplayer-test-start": TestHandlers.multiplayerTestStart,
	"/api/multiplayer-test-state": TestHandlers.multiplayerTestState,
	"/api/multiplayer-test-add-players": TestHandlers.multiplayerTestAddPlayers,
	"/api/multiplayer-test-leave-client": TestHandlers.multiplayerTestLeaveClient,
	"/api/multiplayer-test-end": TestHandlers.multiplayerTestEnd,
	"/api/character-navigation": TestHandlers.characterNavigation,
	"/api/export-build": BuildHandlers.exportBuild,
	"/api/import-build": BuildHandlers.importBuild,
	"/api/import-scene": BuildHandlers.importScene,
	"/api/search-materials": BuildHandlers.searchMaterials,
	"/api/insert-asset": AssetHandlers.insertAsset,
	"/api/preview-asset": AssetHandlers.previewAsset,
	"/api/capture-screenshot": CaptureHandlers.captureScreenshot,
	"/api/capture-begin": CaptureHandlers.captureBegin,
	"/api/capture-read": CaptureHandlers.captureRead,
	"/api/simulate-mouse-input": InputHandlers.simulateMouseInput,
	"/api/simulate-keyboard-input": InputHandlers.simulateKeyboardInput,
	"/api/find-and-replace-in-scripts": ScriptHandlers.findAndReplaceInScripts,
	"/api/get-runtime-logs": LogHandlers.getRuntimeLogs,
	"/api/breakpoints": BreakpointHandlers.breakpoints,
	"/api/capture-script-profiler": ScriptProfilerHandlers.captureScriptProfiler,
	"/api/capture-micro-profiler": MicroProfilerHandlers.captureMicroProfiler,
	"/api/export-rbxm": SerializationHandlers.exportRbxm,
	"/api/import-rbxm": SerializationHandlers.importRbxm,
	"/api/get-memory-breakdown": MemoryHandlers.getMemoryBreakdown,
	"/api/get-scene-analysis": SceneAnalysisHandlers.getSceneAnalysis,
};

export default routes;
