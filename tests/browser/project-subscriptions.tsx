import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectSnapshot } from "#/projects/format.ts";
import * as projectHooks from "#/projects/ProjectProvider.tsx";
import type { ProjectContextValue } from "#/projects/ProjectSession.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import type { SymbolLibraryStorage } from "#/symbol-library/storage.tsx";

const counts = { actions: 0, status: 0, snapshot: 0, editor: 0 };
let current: ProjectSnapshot = {
	directory: "test",
	manifest: {
		format: "ecad-project",
		version: 1,
		name: "Test",
		drawing: "main.ecaddraw",
		symbols: [],
		assets: [],
	},
	shapes: [],
	symbols: [],
};
const storage: ProjectStorage = {
	mode: "web",
	async load() {
		return { ...current, manifest: { ...current.manifest } };
	},
	async list() {
		return [];
	},
	async open() {
		return current;
	},
	async create() {
		return current;
	},
	async save(_directory, document) {
		current = { ...current, ...document };
		return current;
	},
	async importAssets() {
		return current;
	},
	async readAsset() {
		return new Uint8Array();
	},
};
const symbolStorage: SymbolLibraryStorage = {
	mode: "memory",
	async load() {
		return { symbols: [] };
	},
	async save() {
		return "Saved";
	},
};
const hooks = projectHooks as typeof projectHooks & {
	useProjectActions?: () => Partial<ProjectContextValue> | null;
	useProjectStatus?: () => Partial<ProjectContextValue> | null;
};
function Actions() {
	const value = (hooks.useProjectActions ?? hooks.useProject)();
	counts.actions++;
	useEffect(() => {
		Object.assign(window, {
			projectSubscriptionProbe: {
				counts,
				report: value?.reportUnsavedEdits,
				reload: value?.reload,
				select: value?.selectAsset,
			},
		});
	}, [value]);
	return null;
}
function Status() {
	const value = (hooks.useProjectStatus ?? hooks.useProject)();
	counts.status++;
	return (
		<output id="status">
			{JSON.stringify({
				busy: value?.busy,
				otherUnsavedEdits: value?.otherUnsavedEdits,
			})}
		</output>
	);
}
function Snapshot() {
	(hooks.useProjectSnapshot ?? hooks.useProject)();
	counts.snapshot++;
	return null;
}
function Editor() {
	(hooks.useProjectEditor ?? hooks.useProject)();
	counts.editor++;
	return null;
}
createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<projectHooks.ProjectProvider
			storage={storage}
			symbolStorage={symbolStorage}
			wrapChildren={false}
		>
			<Actions />
			<Status />
			<Snapshot />
			<Editor />
		</projectHooks.ProjectProvider>
	</StrictMode>,
);
