import { Keyed } from "@ecad/core/components/ui/Keyed.tsx";
import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
import {
	projectFileSelections,
	projectFileUrlPath,
} from "@ecad/core/projects/file-url.ts";
import { ProjectFilesSidebar } from "@ecad/core/projects/ProjectFilesSidebar.tsx";
import type { ProjectLinkProps } from "@ecad/core/projects/ProjectLink.tsx";
import {
	ProjectProvider,
	useProject,
} from "@ecad/core/projects/ProjectProvider.tsx";
import { type JSX, Portal } from "@solidjs/web";
import {
	Outlet,
	useLocation,
	useNavigate,
	useRouterState,
	useSearch,
} from "@tanstack/solid-router";
import {
	type Component,
	createEffect,
	createSignal,
	onSettled,
	Show,
} from "solid-js";
import { createWebProjectStorage } from "#/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#/symbol-library/storage.ts";

const projectStorage = createWebProjectStorage();
const symbolStorage = createWebSymbolLibraryStorage();

export function AppProjects(props: {
	children: JSX.Element;
	LinkComponent: Component<ProjectLinkProps>;
}) {
	return (
		<ProjectProvider
			storage={projectStorage}
			symbolStorage={symbolStorage}
			LinkComponent={props.LinkComponent}
			wrapChildren={false}
		>
			<ProjectSidebarPortal />
			{props.children}
		</ProjectProvider>
	);
}

function ProjectSidebarPortal() {
	const project = useProject();
	const [host, setHost] = createSignal<HTMLElement | null>(null);
	onSettled(() => {
		setHost(document.getElementById("project-sidebar"));
	});
	return (
		<Show when={host()}>
			{(mount) => (
				<Portal mount={mount()}>
					<Keyed key={project()?.session}>
						<ProjectFilesSidebar />
					</Keyed>
				</Portal>
			)}
		</Show>
	);
}

export function AppWorkspace() {
	useProjectFileUrl();
	const path = useRouterState({
		select: (state) =>
			state.resolvedLocation?.pathname ?? state.location.pathname,
	});
	return (
		<PerformanceBoundary
			name={path() === "/" ? "workspace" : path().slice(1)}
			path={path()}
		>
			<Outlet />
		</PerformanceBoundary>
	);
}

function useProjectFileUrl() {
	const project = useProject();
	const href = useLocation({ select: (location) => location.href });
	const pathname = useLocation({ select: (location) => location.pathname });
	const file = useSearch({ from: "__root__", select: (search) => search.file });
	const view = useSearch({ from: "__root__", select: (search) => search.view });
	const navigate = useNavigate();
	const navigating = useRouterState({
		select: (state) => state.status !== "idle" || state.isLoading,
	});
	let previous: { href: string; session: number } | null = null;
	let pending: { id: string } | null = null;
	const [failedRestoration, setFailedRestoration] = createSignal<{
		id: string;
	} | null>(null);

	createEffect(
		() => ({
			context: project(),
			location: { href: href(), pathname: pathname() },
			file: file(),
			view: view(),
			navigating: navigating(),
			failedRestoration: failedRestoration(),
		}),
		({ context, location, file, view, navigating, failedRestoration }) => {
			if (!context?.project || context.busy || navigating) return;
			const {
				project,
				editorCircuit,
				editorDrawing,
				editorSymbol,
				editorFootprint,
				editorBoard,
			} = context;
			const { manifest } = project;
			const path = location.pathname;
			if (path !== "/editor" && path !== "/step" && path !== "/gerber") {
				previous = null;
				pending = null;
				return;
			}
			const selections = projectFileSelections(project);
			const activeId =
				path === "/editor"
					? editorCircuit
						? `circuit:${editorCircuit.file.circuit.id}`
						: editorSymbol
							? `symbol:${editorSymbol.file.id}`
							: editorFootprint
								? `footprint:${editorFootprint.file.id}`
								: editorBoard
									? `board:${editorBoard.file.circuitId}`
									: editorDrawing
										? `drawing:${editorDrawing.file.id}`
										: "drawing"
					: context.selectedAsset?.kind ===
							(path === "/step" ? "step" : "gerber")
						? `asset:${context.selectedAsset.path}`
						: undefined;
			const active = selections.find((entry) => entry.id === activeId);
			const requested = file
				? selections.find(
						(entry) =>
							entry.file === projectFileUrlPath(file) &&
							entry.view === view &&
							(path === "/editor"
								? !entry.id.startsWith("asset:")
								: manifest.assets.some(
										(asset) =>
											asset.path === entry.path &&
											asset.kind === (path === "/step" ? "step" : "gerber"),
									)),
					)
				: undefined;
			const restorationFailed =
				pending !== null && pending === failedRestoration;
			if (restorationFailed) pending = null;
			const changedLocation = previous?.href !== location.href;
			const changedProject = previous?.session !== context.session;
			const initial = previous === null || changedProject;
			previous = { href: location.href, session: context.session };
			if (changedLocation || changedProject) {
				pending = null;
				if (!file && path !== "/editor" && context.selectedAsset) {
					context.selectAsset(null);
					return;
				}
				if (requested && requested.id !== active?.id) {
					const request = { id: requested.id };
					pending = request;
					if (path === "/editor") {
						const selection =
							requested.view === "circuit"
								? context.openCircuit(requested.path)
								: requested.view === "pcb"
									? context.openBoard(requested.path)
									: context.selectEditorFile(requested.path);
						const failed = () => {
							if (pending === request) setFailedRestoration(request);
						};
						void Promise.resolve(selection).then((selected) => {
							if (!selected) failed();
						}, failed);
					} else {
						const asset = manifest.assets.find(
							(entry) => entry.path === requested.path,
						);
						if (asset) context.selectAsset(asset);
					}
					return;
				}
			}
			if (pending && pending.id !== active?.id) return;
			pending = null;
			if (active?.file !== file || active?.view !== view) {
				void navigate({
					to: path,
					search: (previous) => ({
						...previous,
						file: active?.file,
						view: active?.view,
					}),
					replace:
						initial ||
						!file ||
						requested?.id === active?.id ||
						restorationFailed,
				});
			}
		},
	);
}
