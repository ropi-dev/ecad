import "@ecad/core/performance/initialize.ts";
import { Editor2D } from "@ecad/core/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "@ecad/core/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "@ecad/core/components/step/StepWorkspace.tsx";
import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
import { ProjectProvider } from "@ecad/core/projects/ProjectProvider.tsx";
import { ProjectShell } from "@ecad/core/projects/ProjectShell.tsx";
import { WorkspaceStart } from "@ecad/core/projects/WorkspaceStart.tsx";
import { setSettingsStorage } from "@ecad/core/settings/store.ts";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	createDesktopProjectStorage,
	createDesktopSettingsStorage,
	createDesktopSymbolLibraryStorage,
} from "#/renderer/storage.ts";
import "@ecad/core/styles.css";
import "#/renderer/window.css";

type Workspace = "home" | "editor" | "gerber" | "step";
const storage = createDesktopSymbolLibraryStorage(window.ecadSymbolLibrary);
const projects = createDesktopProjectStorage(window.ecadProjects);
function App() {
	const [workspace, setWorkspace] = useState<Workspace>("home");
	useEffect(() => {
		const navigate = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const href = target.closest("a")?.getAttribute("href");
			const next: Workspace | undefined =
				href === "/"
					? "home"
					: href === "/gerber"
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
		<ProjectProvider storage={projects} symbolStorage={storage}>
			<ProjectShell onExit={() => void window.ecadApp.quit()}>
				<PerformanceBoundary
					name={workspace}
					path={workspace === "home" ? "/" : `/${workspace}`}
				>
					{workspace === "home" ? (
						<WorkspaceStart />
					) : workspace === "editor" ? (
						<Editor2D enableMcp={false} />
					) : workspace === "gerber" ? (
						<GerberWorkspace />
					) : (
						<StepWorkspace />
					)}
				</PerformanceBoundary>
			</ProjectShell>
		</ProjectProvider>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("The desktop editor root element is missing.");
void createDesktopSettingsStorage(window.ecadSettings).then((settings) => {
	setSettingsStorage(settings);
	createRoot(root).render(<App />);
});
