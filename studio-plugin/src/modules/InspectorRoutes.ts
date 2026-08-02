import QueryHandlers from "./handlers/QueryHandlers";
import PropertyHandlers from "./handlers/PropertyHandlers";
import ScriptHandlers from "./handlers/ScriptHandlers";
import MetadataHandlers from "./handlers/MetadataHandlers";
import TestHandlers from "./handlers/TestHandlers";
import BuildHandlers from "./handlers/BuildHandlers";
import AssetHandlers from "./handlers/AssetHandlers";
import CaptureHandlers from "./handlers/CaptureHandlers";
import LogHandlers from "./handlers/LogHandlers";
import SerializationHandlers from "./handlers/SerializationHandlers";
import MemoryHandlers from "./handlers/MemoryHandlers";
import SceneAnalysisHandlers from "./handlers/SceneAnalysisHandlers";
import ScriptProfilerHandlers from "./handlers/ScriptProfilerHandlers";
import MicroProfilerHandlers from "./handlers/MicroProfilerHandlers";
import JobHandlers from "./handlers/JobHandlers";
import type { PluginHandler } from "./PluginRoutes";

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
	"/api/mass-get-property": PropertyHandlers.massGetProperty,
	"/api/get-script-source": ScriptHandlers.getScriptSource,
	"/api/read-managed-scripts": ScriptHandlers.readManagedScripts,
	"/api/get-attributes": MetadataHandlers.getAttributes,
	"/api/get-tags": MetadataHandlers.getTags,
	"/api/get-tagged": MetadataHandlers.getTagged,
	"/api/get-selection": MetadataHandlers.getSelection,
	"/api/get-job-status": JobHandlers.getJobStatus,
	"/api/get-job-result": JobHandlers.getJobResult,
	"/api/multiplayer-test-state": TestHandlers.multiplayerTestState,
	"/api/export-build": BuildHandlers.exportBuild,
	"/api/search-materials": BuildHandlers.searchMaterials,
	"/api/preview-asset": AssetHandlers.previewAsset,
	"/api/capture-screenshot": CaptureHandlers.captureScreenshot,
	"/api/capture-begin": CaptureHandlers.captureBegin,
	"/api/capture-read": CaptureHandlers.captureRead,
	"/api/get-runtime-logs": LogHandlers.getRuntimeLogs,
	"/api/capture-script-profiler": ScriptProfilerHandlers.captureScriptProfiler,
	"/api/capture-micro-profiler": MicroProfilerHandlers.captureMicroProfiler,
	"/api/export-rbxm": SerializationHandlers.exportRbxm,
	"/api/get-memory-breakdown": MemoryHandlers.getMemoryBreakdown,
	"/api/get-scene-analysis": SceneAnalysisHandlers.getSceneAnalysis,
};

export default routes;
