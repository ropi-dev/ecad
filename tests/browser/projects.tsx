import { StrictMode, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Scene } from "three";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "#/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "#/components/step/StepWorkspace.tsx";
import { ProjectShell } from "#/projects/ProjectShell.tsx";
import { ProjectPage } from "#/projects/ProjectPage.tsx";
import { ProjectProvider, useProject } from "#/projects/ProjectProvider.tsx";
import { createWebProjectStorage } from "#web/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import "#/styles.css";

Scene.prototype.onAfterRender = function () {
	document.documentElement.dataset.worksheet = this.getObjectByName("Worksheet frame")?.parent?.name ?? "none";
};

function ProjectDocument() {
	const project = useProject();
	if (!project) throw new Error("Project provider is missing.");
	const drawing = useSyncExternalStore(project.store.subscribe, project.store.getSnapshot);
	const editorStore = project.editorSymbol?.store ?? project.store;
	const editor = useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot);
	return <output id="project-document" hidden>{JSON.stringify({ shapes: drawing.shapes, nextShapeId: drawing.nextShapeId, name: project.project?.manifest.name, assets: project.project?.manifest.assets, dirty: project.dirty, symbols: project.project?.symbols, editorShapes: editor.shapes })}</output>;
}

const storage = createWebProjectStorage();
const symbolStorage = createWebSymbolLibraryStorage();

function App() {
	const [workspace, setWorkspace] = useState("/projects");
	useEffect(() => {
		const navigate = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const href = target.closest("a")?.getAttribute("href");
			if (href !== "/" && href !== "/step" && href !== "/editor" && href !== "/projects") return;
			event.preventDefault();
			setWorkspace(href);
		};
		document.addEventListener("click", navigate);
		return () => document.removeEventListener("click", navigate);
	}, []);
	return <ProjectProvider storage={storage} symbolStorage={symbolStorage}>
		<ProjectDocument />
		<ProjectShell>{workspace === "/projects" ? <ProjectPage /> : workspace === "/editor" ? <Editor2D /> : workspace === "/" ? <GerberWorkspace /> : <StepWorkspace />}</ProjectShell>
	</ProjectProvider>;
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><App /></StrictMode>);
