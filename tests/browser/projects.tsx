import { StrictMode, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Scene } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "#/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "#/components/step/StepWorkspace.tsx";
import { ProjectProvider, useProject } from "#/projects/ProjectProvider.tsx";
import { ProjectShell } from "#/projects/ProjectShell.tsx";
import { WorkspaceStart } from "#/projects/WorkspaceStart.tsx";
import { createWebProjectStorage } from "#web/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import "#/styles.css";

Scene.prototype.onAfterRender = function (_renderer, _scene, camera) {
	document.documentElement.dataset.editorCamera = JSON.stringify({
		x: camera.position.x,
		y: camera.position.y,
		projection: camera.projectionMatrix.toArray(),
	});
	const pinLabels: string[] = [];
	this.getObjectByName("editor-shapes")?.traverse((child) => {
		if (/^pin (name|number) /.test(child.name)) pinLabels.push(child.name);
	});
	document.documentElement.dataset.pinLabels = JSON.stringify(pinLabels);
	document.documentElement.dataset.worksheet =
		this.getObjectByName("Worksheet frame")?.parent?.name ?? "none";
};

function CircuitDocumentState() {
	const project = useProject();
	const store = project?.editorCircuit?.store;
	if (!store) return null;
	return <CircuitSnapshot store={store} />;
}
function CircuitSnapshot({
	store,
}: {
	store: import("@ecad/drawing-core/circuit/store.ts").CircuitStore;
}) {
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
	return (
		<output id="circuit-document" hidden>
			{JSON.stringify({ circuit: snapshot.circuit, graph: snapshot.graph })}
		</output>
	);
}
function ProjectDocument() {
	const project = useProject();
	if (!project) throw new Error("Project provider is missing.");
	const drawing = useSyncExternalStore(
		project.store.subscribe,
		project.store.getSnapshot,
	);
	const editorStore =
		project.editorSymbol?.store ??
		project.editorDrawing?.store ??
		project.store;
	const editor = useSyncExternalStore(
		editorStore.subscribe,
		editorStore.getSnapshot,
	);
	return (
		<output id="project-document" hidden>
			{JSON.stringify({
				shapes: drawing.shapes,
				nextShapeId: drawing.nextShapeId,
				name: project.project?.manifest.name,
				assets: project.project?.manifest.assets,
				dirty: project.dirty,
				symbols: project.project?.symbols,
				drawings: project.project?.drawings,
				editorDrawing: project.editorDrawing?.file.id,
				editorShapes: editor.shapes,
			})}
		</output>
	);
}

const storage = createWebProjectStorage();
const symbolStorage = createWebSymbolLibraryStorage();

function App() {
	const [workspace, setWorkspace] = useState("/");
	useEffect(() => {
		const navigate = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const href = target.closest("a")?.getAttribute("href");
			if (
				href !== "/" &&
				href !== "/step" &&
				href !== "/editor" &&
				href !== "/gerber"
			)
				return;
			event.preventDefault();
			setWorkspace(href);
		};
		document.addEventListener("click", navigate);
		return () => document.removeEventListener("click", navigate);
	}, []);
	return (
		<ProjectProvider storage={storage} symbolStorage={symbolStorage}>
			<ProjectDocument />
			<CircuitDocumentState />
			<ProjectShell>
				{workspace === "/" ? (
					<WorkspaceStart />
				) : workspace === "/editor" ? (
					<Editor2D />
				) : workspace === "/gerber" ? (
					<GerberWorkspace />
				) : (
					<StepWorkspace />
				)}
			</ProjectShell>
		</ProjectProvider>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
