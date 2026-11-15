import { assetFormat, fileSizeProblem } from "#/formats/import-limits.ts";
import { isProjectError, ProjectAssetTooLarge } from "#/projects/errors.ts";
import type { AssetKind, ProjectAsset } from "#/projects/format.ts";
import type { RestoredAssets } from "#/projects/ProjectSession.ts";
import type { ProjectSessionState } from "#/projects/project-session-state.ts";

/**
 * Imports source assets (STEP models, Gerber archives and similar) into the
 * open project and reads them back. Assets added before a project is open
 * wait in `pendingAssets` and are written with the next save.
 */
export function createProjectAssets(state: ProjectSessionState) {
	const { storage, enqueue, noteConflict, update } = state;
	const transferAssets = async (
		files: { file: File; kind: AssetKind }[],
	): Promise<ProjectAsset[]> => {
		const previous = state.active;
		if (!previous) {
			state.pendingAssets.push(...files);
			return [];
		}
		const staged = state.pendingAssets.length;
		const pending = [...state.pendingAssets, ...files];
		if (!pending.length) return [];
		if (state.conflict) throw state.conflict;
		const assets = await Promise.all(
			pending.map(async ({ file, kind }) => ({
				name: file.name,
				kind,
				bytes: new Uint8Array(await file.arrayBuffer()),
			})),
		);
		let next: Awaited<ReturnType<typeof storage.importAssets>>;
		try {
			next = await storage.importAssets(previous.directory, assets);
			update(next);
		} catch (cause) {
			noteConflict(cause);
			throw cause;
		}
		state.pendingAssets.splice(0, staged);
		const existing = new Set(previous.manifest.assets.map(({ path }) => path));
		return next.manifest.assets.filter(({ path }) => !existing.has(path));
	};
	const importAssets = async (
		files: readonly File[],
		kind: AssetKind,
		epoch: number,
	) => {
		// Checked before anything is read, so an oversized file is never stored.
		for (const file of files) {
			const reason = fileSizeProblem(assetFormat(file.name, kind), file.size);
			if (reason)
				throw new ProjectAssetTooLarge({ assetName: file.name, reason });
		}
		const directory = state.active?.directory;
		return enqueue(() => {
			if (state.generation !== epoch || directory !== state.active?.directory)
				throw new Error("The project changed during the import. Try again.");
			return transferAssets(files.map((file) => ({ file, kind })));
		});
	};
	const readAssets = async (kind: AssetKind): Promise<RestoredAssets> => {
		const snapshot = state.active;
		if (!snapshot)
			return {
				files: state.pendingAssets
					.filter((asset) => asset.kind === kind)
					.map((asset) => asset.file),
				problems: [],
			};
		const read = await Promise.all(
			snapshot.manifest.assets
				.filter(
					(asset) =>
						asset.kind === kind &&
						(!state.selectedAsset ||
							state.selectedAsset.kind !== kind ||
							asset.path === state.selectedAsset.path),
				)
				.map(async (asset) => {
					try {
						const bytes = await storage.readAsset(
							snapshot.directory,
							asset.path,
						);
						return new File([new Uint8Array(bytes).buffer], asset.name);
					} catch (cause) {
						// One oversized asset must not keep the others from loading.
						if (isProjectError(cause, "ProjectAssetTooLarge")) return cause;
						throw cause;
					}
				}),
		);
		return {
			files: read.filter((entry) => entry instanceof File),
			problems: read.flatMap((entry) =>
				entry instanceof File ? [] : [entry.message],
			),
		};
	};
	return { transferAssets, importAssets, readAssets };
}
