import type {
	AssetKind,
	ProjectDocument,
	ProjectSnapshot,
} from "#/projects/format.ts";
import type { ProjectSettings } from "#/settings/schema.ts";

/** The project as it is now on disk, and the project paths that changed. */
export interface ProjectRefresh {
	snapshot: ProjectSnapshot;
	changed: string[];
}

export interface ProjectStorage {
	mode: "desktop" | "web";
	load(): Promise<ProjectSnapshot | null>;
	list(): Promise<string[]>;
	create(name: string): Promise<ProjectSnapshot | null>;
	open(name?: string): Promise<ProjectSnapshot | null>;
	save(directory: string, document: ProjectDocument): Promise<ProjectSnapshot>;
	saveProject?(directory: string): Promise<ProjectSnapshot | null>;
	importAssets(
		directory: string,
		assets: { name: string; kind: AssetKind; bytes: Uint8Array }[],
	): Promise<ProjectSnapshot>;
	readAsset(directory: string, path: string): Promise<Uint8Array>;
	saveSettings?(
		directory: string,
		settings: ProjectSettings,
	): Promise<ProjectSnapshot>;
	canWriteFile?(directory: string, path: string): Promise<boolean>;
	/**
	 * Calls the listener with the open project's directory when another
	 * program may have changed its files. Storage without a file watcher
	 * leaves this out.
	 */
	subscribeExternalChanges?(listener: (directory: string) => void): () => void;
	/**
	 * Re-reads the open project and makes the files on disk its saved state.
	 * Resolves to null when no project file changed.
	 */
	refresh?(directory: string): Promise<ProjectRefresh | null>;
}
