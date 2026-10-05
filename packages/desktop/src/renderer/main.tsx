import "@ecad/core/performance/initialize.ts";
import { Editor2D } from "@ecad/core/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "@ecad/core/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "@ecad/core/components/step/StepWorkspace.tsx";
import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
import { ProjectPage } from "@ecad/core/projects/ProjectPage.tsx";
import { ProjectProvider } from "@ecad/core/projects/ProjectProvider.tsx";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createDesktopSymbolLibraryStorage } from "#/renderer/storage.ts";
import "@ecad/core/styles.css";

type Workspace = "projects" | "editor" | "gerber" | "step";
const storage = createDesktopSymbolLibraryStorage(window.ecadSymbolLibrary);
function App() {
	const [workspace, setWorkspace] = useState<Workspace>("projects");
	useEffect(() => {
		const navigate = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const href = target.closest("a")?.getAttribute("href");
			const next: Workspace | undefined =
				href === "/projects"
					? "projects"
					: href === "/"
						? "gerber"
						: href === "/editor"
							? "editor"
							: href === "/step"
								? "step"
								: undefined;
			if (!next) return;
			event.preventDefault();
			setWorkspace(next);
		};
		document.addEventListener("click", navigate);
		return () => document.removeEventListener("click", navigate);
	}, []);
	return (
		<ProjectProvider storage={window.ecadProjects} symbolStorage={storage}>
			<PerformanceBoundary
				name={workspace}
				path={workspace === "gerber" ? "/" : `/${workspace}`}
			>
				{workspace === "projects" ? (
					<ProjectPage />
				) : workspace === "editor" ? (
					<Editor2D enableMcp={false} />
				) : workspace === "gerber" ? (
					<GerberWorkspace />
				) : (
					<StepWorkspace />
				)}
			</PerformanceBoundary>
		</ProjectProvider>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("The desktop editor root element is missing.");
createRoot(root).render(<App />);
