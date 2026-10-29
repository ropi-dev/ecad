import type {
	AssetKind,
	ProjectDocument,
	ProjectSnapshot,
} from "#/projects/format.ts";

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
	canWriteFile?(directory: string, path: string): Promise<boolean>;
}
