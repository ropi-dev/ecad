import "@ecad/core/performance/initialize.ts";
import { Editor2D } from "@ecad/core/components/editor/Editor2D.tsx";
import { GerberWorkspace } from "@ecad/core/components/gerber/GerberWorkspace.tsx";
import { StepWorkspace } from "@ecad/core/components/step/StepWorkspace.tsx";
import { setDialogWindows } from "@ecad/core/components/ui/dialog-window.ts";
import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
import { ProjectFilesSidebar } from "@ecad/core/projects/ProjectFilesSidebar.tsx";
import { ProjectProvider } from "@ecad/core/projects/ProjectProvider.tsx";
import { ProjectShell } from "@ecad/core/projects/ProjectShell.tsx";
import { WorkspaceStart } from "@ecad/core/projects/WorkspaceStart.tsx";
import { setSettingsStorage } from "@ecad/core/settings/store.ts";
import { setConsentStorage } from "@ecad/core/telemetry/consent.ts";
import { startTelemetry } from "@ecad/core/telemetry/telemetry.ts";
import { render } from "@solidjs/web";
import { createSignal, Match, onSettled, Switch } from "solid-js";
import { createDesktopMcpConnector } from "#/renderer/mcp.ts";
import {
	createDesktopConsentStorage,
	createDesktopProjectStorage,
	createDesktopSettingsStorage,
	createDesktopSymbolLibraryStorage,
} from "#/renderer/storage.ts";
import { UpdateButton } from "#/renderer/UpdateButton.tsx";
import "@ecad/core/styles.css";
import "#/renderer/window.css";

type Workspace = "home" | "editor" | "gerber" | "step";
const storage = createDesktopSymbolLibraryStorage(window.ecadSymbolLibrary);
const projects = createDesktopProjectStorage(window.ecadProjects);
const mcp = createDesktopMcpConnector(window.ecadMcp);
setDialogWindows(true);
function App() {
	const [workspace, setWorkspace] = createSignal<Workspace>("home");
	onSettled(() => {
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
	});
	return (
		<ProjectProvider storage={projects} symbolStorage={storage}>
			<ProjectShell
				sidebar={
					<ProjectFilesSidebar
						onExit={() => void window.ecadApp.quit()}
						footerActions={<UpdateButton updates={window.ecadUpdates} />}
						mcp={mcp}
					/>
				}
			>
				<PerformanceBoundary
					name={workspace()}
					path={workspace() === "home" ? "/" : `/${workspace()}`}
				>
					<Switch fallback={<StepWorkspace />}>
						<Match when={workspace() === "home"}>
							<WorkspaceStart />
						</Match>
						<Match when={workspace() === "editor"}>
							<Editor2D />
						</Match>
						<Match when={workspace() === "gerber"}>
							<GerberWorkspace />
						</Match>
					</Switch>
				</PerformanceBoundary>
			</ProjectShell>
		</ProjectProvider>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("The desktop editor root element is missing.");
void Promise.all([
	createDesktopSettingsStorage(window.ecadSettings, window.ecadUpdates),
	createDesktopConsentStorage(window.ecadTelemetry),
]).then(([settings, consent]) => {
	setSettingsStorage(settings);
	setConsentStorage(consent);
	startTelemetry({
		platform: "desktop",
		transport: (batch, revision) => window.ecadTelemetry.send(batch, revision),
	});
	render(() => <App />, root);
});
