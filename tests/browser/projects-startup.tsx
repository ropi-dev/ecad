import { createRoot } from "react-dom/client";
import { ProjectShell } from "#/projects/ProjectShell.tsx";
import { ProjectPage } from "#/projects/ProjectPage.tsx";
import { ProjectProvider } from "#/projects/ProjectProvider.tsx";
import type { ProjectSnapshot } from "#/projects/format.ts";
import type { ProjectStorage } from "#/projects/storage.ts";
import { createMemorySymbolLibraryStorage } from "#/symbol-library/storage.tsx";
import "#/styles.css";

const snapshot: ProjectSnapshot = {
	directory: "Large project",
	shapes: [],
	symbols: [],
	manifest: {
		format: "ecad-project", version: 1, name: "Large project", drawing: "drawing.ecaddraw", symbols: [],
		assets: Array.from({ length: 10000 }, (_, index) => ({ name: `file-${index}.gbr`, path: `assets/file-${index}.gbr`, kind: "gerber" })),
	},
};
const storage: ProjectStorage = {
	mode: "web",
	load: async () => snapshot,
	list: async () => [snapshot.directory],
	open: async () => snapshot,
	create: async () => snapshot,
	save: async () => snapshot,
	importAssets: async () => snapshot,
	readAsset: async () => new Uint8Array(),
};
createRoot(document.getElementById("root") as HTMLElement).render(<ProjectProvider storage={storage} symbolStorage={createMemorySymbolLibraryStorage()}><ProjectShell><ProjectPage /></ProjectShell></ProjectProvider>);
