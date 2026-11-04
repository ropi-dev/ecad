import { createRoot } from "react-dom/client";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { ProjectShell } from "#/projects/ProjectShell.tsx";
import { WorkspaceStart } from "#/projects/WorkspaceStart.tsx";
import { ProjectProvider } from "#/projects/ProjectProvider.tsx";
import type { ProjectSnapshot } from "#/projects/format.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import { createMemorySymbolLibraryStorage } from "#/symbol-library/storage.tsx";
import "#/styles.css";

const parameters = new URLSearchParams(location.search);
const symbols = ["test-point", "power-connector"].map((id) =>
	parseSymbolFile(
		JSON.stringify({
			format: "ecad-symbol",
			version: 1,
			units: "mm",
			id,
			name: id,
			description: "",
			prefix: "TP",
			value: "",
			shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
		}),
	),
);
let snapshot: ProjectSnapshot = {
	directory: "/home/ropi/ElectronicsProjects/Motor controller",
	shapes: [],
	symbols,
	manifest: {
		format: "ecad-project",
		version: 1,
		name: "Motor controller",
		drawing: "drawing.ecaddraw",
		symbols: symbols.map((symbol) => `symbols/${symbol.id}.ecadsym`),
		assets: [
			{
				name: "controller-F_Cu.gbr",
				path: "assets/controller-F_Cu.gbr",
				kind: "gerber",
			},
			{
				name: "controller-B_Cu.gbr",
				path: "assets/controller-B_Cu.gbr",
				kind: "gerber",
			},
			{
				name: "controller-Edge_Cuts.gbr",
				path: "assets/controller-Edge_Cuts.gbr",
				kind: "gerber",
			},
			{ name: "enclosure.step", path: "assets/enclosure.step", kind: "step" },
		],
	},
};
declare global {
	interface Window {
		projectSwitchTest: {
			calls: { open: number; save: number };
			cancelOpen: boolean;
			cancelSave: boolean;
			failSave: boolean;
		};
	}
}
const switching = {
	calls: { open: 0, save: 0 },
	cancelOpen: false,
	cancelSave: false,
	failSave: false,
};
window.projectSwitchTest = switching;
const storage: ProjectStorage = {
	mode: "desktop",
	load: async () => (parameters.has("empty") ? null : snapshot),
	list: async () => [],
	open: async () => {
		switching.calls.open++;
		if (switching.cancelOpen) return null;
		snapshot = {
			...snapshot,
			inMemory: false,
			directory: "/Existing",
			manifest: { ...snapshot.manifest, name: "Existing project" },
		};
		return snapshot;
	},
	create: async (name) => {
		snapshot = {
			...snapshot,
			inMemory: parameters.has("empty"),
			directory: `/home/ropi/ElectronicsProjects/${name}`,
			manifest: { ...snapshot.manifest, name },
		};
		return snapshot;
	},
	save: async (_directory, document) => {
		if (parameters.has("save-error"))
			throw new Error("The project changed on disk. Reopen it before saving.");
		snapshot = { ...snapshot, ...document };
		return snapshot;
	},
	saveProject: async () => {
		switching.calls.save++;
		if (switching.failSave) throw new Error("Disk full");
		if (switching.cancelSave) return null;
		snapshot = { ...snapshot, inMemory: false };
		return snapshot;
	},
	importAssets: async () => snapshot,
	readAsset: async () => new Uint8Array(),
};
createRoot(document.getElementById("root") as HTMLElement).render(
	<ProjectProvider
		storage={storage}
		symbolStorage={createMemorySymbolLibraryStorage()}
	>
		<ProjectShell>
			<WorkspaceStart />
		</ProjectShell>
	</ProjectProvider>,
);
