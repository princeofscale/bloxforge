export interface RojoProject {
  name: string;
  root: string;
  projectFile: string;
  servePort?: number;
  serveAddress?: string;
  servePlaceIds?: number[];
  emitLegacyScripts?: boolean;
  globIgnorePaths?: string[];
  /** `syncbackRules.ignorePaths` — paths Rojo syncback will not write. */
  syncbackIgnorePaths?: string[];
  tree: Record<string, unknown>;
}

export type RojoSourceKind =
  | 'Script'
  | 'LocalScript'
  | 'ModuleScript'
  | 'PluginScript'
  | 'meta'
  | 'model'
  | 'value'
  | 'project';

export interface RojoSourceMapping {
  kind: RojoSourceKind;
  instanceName?: string;
}
