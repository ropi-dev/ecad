import { StrictMode, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Scene } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "#/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "#/components/step/StepWorkspace.tsx";
import { ProjectProvider, useProject } from "#/projects/ProjectProvider.tsx";
import { ProjectShell } from "#/projects/ProjectShell.tsx";
import { WorkspaceStart } from "#/projects/WorkspaceStart.tsx";
import { startTelemetry } from "#/telemetry/telemetry.ts";
import { createWebProjectStorage } from "#web/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import "#/styles.css";

Scene.prototype.onAfterRender = (renderer, _scene, camera) => {
	renderer.domElement.dataset.editorCamera = JSON.stringify({
		x: camera.position.x,
		y: camera.position.y,
		projection: camera.projectionMatrix.toArray(),
	});
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
		project.editorFootprint?.store ??
		project.editorBoard?.store ??
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
				name: project.project?.manifest.name,
				assets: project.project?.manifest.assets,
				dirty: project.dirty,
				symbols: project.project?.symbols,
				drawings: project.project?.drawings,
				footprints: project.project?.footprints,
				boards: project.project?.boards?.map((board) => board.circuitId),
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

startTelemetry();

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
