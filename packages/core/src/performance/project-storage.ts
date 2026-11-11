import { measurePerformanceAsync } from "#/performance/runtime.ts";
import type { ProjectStorage } from "#/projects/storage.ts";

export function instrumentProjectStorage(
	storage: ProjectStorage,
): ProjectStorage {
	return {
		mode: storage.mode,
		canWriteFile: storage.canWriteFile?.bind(storage),
		saveProject: storage.saveProject?.bind(storage),
		saveSettings: storage.saveSettings?.bind(storage),
		subscribeExternalChanges: storage.subscribeExternalChanges?.bind(storage),
		refresh:
			storage.refresh &&
			((directory) =>
				measurePerformanceAsync("project.external-refresh", () =>
					(storage.refresh as NonNullable<ProjectStorage["refresh"]>)(
						directory,
					),
				)),
		load: () => measurePerformanceAsync("project.load", () => storage.load()),
		list: () => measurePerformanceAsync("project.list", () => storage.list()),
		create: (name) =>
			measurePerformanceAsync("project.create", () => storage.create(name)),
		open: (name) =>
			measurePerformanceAsync("project.open", () => storage.open(name)),
		save: (directory, document) =>
			measurePerformanceAsync(
				"project.save",
				() => storage.save(directory, document),
				{ shapes: document.shapes.length, symbols: document.symbols.length },
			),
		importAssets: (directory, assets) =>
			measurePerformanceAsync(
				"project.import",
				() => storage.importAssets(directory, assets),
				{
					files: assets.length,
					bytes: assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0),
				},
			),
		readAsset: (directory, path) =>
			measurePerformanceAsync("project.read-asset", () =>
				storage.readAsset(directory, path),
			),
	};
}
