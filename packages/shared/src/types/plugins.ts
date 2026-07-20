/**
 * Plugin system contract. Every major capability (AI providers, transcription
 * engines, material generators, exporters, visualizations) is registered
 * through typed extension points — built-in features use the same mechanism
 * third-party plugins would.
 */

export type ExtensionPointId =
  | 'ai-provider'
  | 'transcription-provider'
  | 'embedding-provider'
  | 'material-generator'
  | 'exporter'
  | 'visualization';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  /** Extension points this plugin contributes to. */
  contributes: ExtensionPointId[];
  /** True for plugins bundled with the app. */
  builtIn: boolean;
}

export interface PluginInfo extends PluginManifest {
  enabled: boolean;
}
