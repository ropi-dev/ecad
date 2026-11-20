import { render } from "@solidjs/web";
import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import { Scene } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "#/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "#/components/step/StepWorkspace.tsx";
import { useExternalStore } from "#/lib/external-store.ts";
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
	return (
		<Show when={project()?.editorCircuit?.store} keyed>
			{(store) => {
				const snapshot = useExternalStore(store);
				return (
					<output id="circuit-document" hidden>
						{JSON.stringify({
							circuit: snapshot().circuit,
							graph: snapshot().graph,
						})}
					</output>
				);
			}}
		</Show>
	);
}
function ProjectDocument() {
	const project = useProject();
	const editorStore = () => {
		const current = project();
		return (
			current?.editorSymbol?.store ??
			current?.editorFootprint?.store ??
			current?.editorBoard?.store ??
			current?.editorDrawing?.store ??
			current?.store
		);
	};
	return (
		<Show when={project()?.store} keyed>
			{(store) => {
				const drawing = useExternalStore(store);
				return (
					<Show when={editorStore()} keyed>
						{(editorStore) => {
							const editor = useExternalStore(editorStore);
							return (
								<output id="project-document" hidden>
									{JSON.stringify({
										shapes: drawing().shapes,
										name: project()?.project?.manifest.name,
										assets: project()?.project?.manifest.assets,
										dirty: project()?.dirty,
										symbols: project()?.project?.symbols,
										drawings: project()?.project?.drawings,
										footprints: project()?.project?.footprints,
										boards: project()?.project?.boards?.map(
											(board) => board.circuitId,
										),
										editorDrawing: project()?.editorDrawing?.file.id,
										editorShapes: editor().shapes,
									})}
								</output>
							);
						}}
					</Show>
				);
			}}
		</Show>
	);
}

const storage = createWebProjectStorage();
const symbolStorage = createWebSymbolLibraryStorage();

function App() {
	const [workspace, setWorkspace] = createSignal("/");
	onSettled(() => {
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
	});
	return (
		<ProjectProvider storage={storage} symbolStorage={symbolStorage}>
			<ProjectDocument />
			<CircuitDocumentState />
			<ProjectShell>
				<Switch fallback={<StepWorkspace />}>
					<Match when={workspace() === "/"}>
						<WorkspaceStart />
					</Match>
					<Match when={workspace() === "/editor"}>
						<Editor2D />
					</Match>
					<Match when={workspace() === "/gerber"}>
						<GerberWorkspace />
					</Match>
				</Switch>
			</ProjectShell>
		</ProjectProvider>
	);
}

startTelemetry();

render(() => <App />, document.getElementById("root") as HTMLElement);
