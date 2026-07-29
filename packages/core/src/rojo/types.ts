export interface RojoProject {
  name: string;
  root: string;
  projectFile: string;
  servePort?: number;
  serveAddress?: string;
  servePlaceIds?: number[];
  emitLegacyScripts?: boolean;
  globIgnorePaths?: string[];
  tree: Record<string, unknown>;
}

export type RojoSourceKind =
  | 'Script'
  | 'LocalScript'
  | 'ModuleScript'
  | 'meta'
  | 'model'
  | 'value'
  | 'project';

export interface RojoSourceMapping {
  kind: RojoSourceKind;
  instanceName?: string;
}
