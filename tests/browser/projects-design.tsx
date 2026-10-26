import { createRoot } from "react-dom/client";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { ProjectShell } from "#/projects/ProjectShell.tsx";
import { ProjectPage } from "#/projects/ProjectPage.tsx";
import { ProjectProvider } from "#/projects/ProjectProvider.tsx";
import type { ProjectSnapshot } from "#/projects/format.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import { createMemorySymbolLibraryStorage } from "#/symbol-library/storage.tsx";
import "#/styles.css";

const parameters = new URLSearchParams(location.search);
const symbols = ["test-point", "power-connector"].map((id) => parseSymbolFile(JSON.stringify({
	format: "ecad-symbol", version: 1, units: "mm", id, name: id,
	description: "", prefix: "TP", value: "",
	shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
})));
let snapshot: ProjectSnapshot = {
	directory: "/home/ropi/ElectronicsProjects/Motor controller",
	shapes: [], symbols,
	manifest: {
		format: "ecad-project", version: 1, name: "Motor controller",
		drawing: "drawing.ecaddraw", symbols: symbols.map((symbol) => `symbols/${symbol.id}.ecadsym`),
		assets: [
			{ name: "controller-F_Cu.gbr", path: "assets/controller-F_Cu.gbr", kind: "gerber" },
			{ name: "controller-B_Cu.gbr", path: "assets/controller-B_Cu.gbr", kind: "gerber" },
			{ name: "controller-Edge_Cuts.gbr", path: "assets/controller-Edge_Cuts.gbr", kind: "gerber" },
			{ name: "enclosure.step", path: "assets/enclosure.step", kind: "step" },
		],
	},
};
const storage: ProjectStorage = {
	mode: "desktop",
	load: async () => parameters.has("empty") ? null : snapshot,
	list: async () => [],
	open: async () => snapshot,
	create: async (name) => {
		snapshot = { ...snapshot, directory: `/home/ropi/ElectronicsProjects/${name}`, manifest: { ...snapshot.manifest, name } };
		return snapshot;
	},
	save: async (_directory, document) => {
		if (parameters.has("save-error")) throw new Error("The project changed on disk. Reopen it before saving.");
		snapshot = { ...snapshot, ...document };
		return snapshot;
	},
	importAssets: async () => snapshot,
	readAsset: async () => new Uint8Array(),
};
createRoot(document.getElementById("root") as HTMLElement).render(
	<ProjectProvider storage={storage} symbolStorage={createMemorySymbolLibraryStorage()}><ProjectShell><ProjectPage /></ProjectShell></ProjectProvider>,
);
