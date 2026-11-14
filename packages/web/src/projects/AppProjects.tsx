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
import {
	Outlet,
	useLocation,
	useNavigate,
	useRouterState,
	useSearch,
} from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createWebProjectStorage } from "#/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#/symbol-library/storage.ts";

const projectStorage = createWebProjectStorage();
const symbolStorage = createWebSymbolLibraryStorage();

export function AppProjects({
	children,
	LinkComponent,
}: {
	children: ReactNode;
	LinkComponent: ComponentType<ProjectLinkProps>;
}) {
	return (
		<ProjectProvider
			storage={projectStorage}
			symbolStorage={symbolStorage}
			LinkComponent={LinkComponent}
			wrapChildren={false}
		>
			<ProjectSidebarPortal />
			{children}
		</ProjectProvider>
	);
}

function ProjectSidebarPortal() {
	const project = useProject();
	const [host, setHost] = useState<HTMLElement | null>(null);
	useEffect(() => {
		setHost(document.getElementById("project-sidebar"));
	}, []);
	return host
		? createPortal(<ProjectFilesSidebar key={project?.session} />, host)
		: null;
}

export function AppWorkspace() {
	useProjectFileUrl();
	const path = useRouterState({
		select: (state) =>
			state.resolvedLocation?.pathname ?? state.location.pathname,
	});
	return (
		<PerformanceBoundary
			name={path === "/" ? "workspace" : path.slice(1)}
			path={path}
		>
			<Outlet />
		</PerformanceBoundary>
	);
}

function useProjectFileUrl() {
	const context = useProject();
	const location = useLocation();
	const { file, view } = useSearch({ from: "__root__" });
	const navigate = useNavigate();
	const navigating = useRouterState({
		select: (state) => state.status !== "idle" || state.isLoading,
	});
	const previous = useRef<{ href: string; session: number } | null>(null);
	const pending = useRef<{ id: string } | null>(null);
	const [failedRestoration, setFailedRestoration] = useState<{
		id: string;
	} | null>(null);

	useEffect(() => {
		if (!context?.project || context.busy || navigating) return;
		const {
			project,
			editorCircuit,
			editorDrawing,
			editorSymbol,
			editorFootprint,
		} = context;
		const { manifest } = project;
		const path = location.pathname;
		if (path !== "/editor" && path !== "/step" && path !== "/gerber") {
			previous.current = null;
			pending.current = null;
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
							: editorDrawing
								? `drawing:${editorDrawing.file.id}`
								: "drawing"
				: context.selectedAsset?.kind === (path === "/step" ? "step" : "gerber")
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
			pending.current !== null && pending.current === failedRestoration;
		if (restorationFailed) pending.current = null;
		const changedLocation = previous.current?.href !== location.href;
		const changedProject = previous.current?.session !== context.session;
		const initial = previous.current === null || changedProject;
		previous.current = { href: location.href, session: context.session };
		if (changedLocation || changedProject) {
			pending.current = null;
			if (!file && path !== "/editor" && context.selectedAsset) {
				context.selectAsset(null);
				return;
			}
			if (requested && requested.id !== active?.id) {
				const request = { id: requested.id };
				pending.current = request;
				if (path === "/editor") {
					const selection =
						requested.view === "circuit"
							? context.openCircuit(requested.path)
							: context.selectEditorFile(requested.path);
					const failed = () => {
						if (pending.current === request) setFailedRestoration(request);
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
		if (pending.current && pending.current.id !== active?.id) return;
		pending.current = null;
		if (active?.file !== file || active?.view !== view) {
			void navigate({
				to: path,
				search: (previous) => ({
					...previous,
					file: active?.file,
					view: active?.view,
				}),
				replace:
					initial || !file || requested?.id === active?.id || restorationFailed,
			});
		}
	}, [
		context,
		location.href,
		location.pathname,
		file,
		view,
		navigate,
		navigating,
		failedRestoration,
	]);
}
