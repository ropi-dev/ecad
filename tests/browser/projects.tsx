import { StrictMode, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Editor2D } from "#/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "#/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "#/components/step/StepWorkspace.tsx";
import { ProjectPage } from "#/projects/ProjectPage.tsx";
import { ProjectProvider, useProject } from "#/projects/ProjectProvider.tsx";
import { createWebProjectStorage } from "#web/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#web/symbol-library/storage.ts";
import "#/styles.css";

function ProjectDocument() {
	const project = useProject();
	if (!project) throw new Error("Project provider is missing.");
	const drawing = useSyncExternalStore(project.store.subscribe, project.store.getSnapshot);
	return <output id="project-document" hidden>{JSON.stringify({ shapes: drawing.shapes, nextShapeId: drawing.nextShapeId, name: project.project?.manifest.name, assets: project.project?.manifest.assets, dirty: project.dirty })}</output>;
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
		{workspace === "/projects" ? <ProjectPage /> : workspace === "/editor" ? <Editor2D enableMcp={false} /> : workspace === "/" ? <GerberWorkspace /> : <StepWorkspace />}
	</ProjectProvider>;
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><App /></StrictMode>);
