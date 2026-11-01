import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
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
	const pending = useRef<{ file: string; view?: "circuit" } | null>(null);

	useEffect(() => {
		if (!context?.project || context.busy || navigating) return;
		const { project, editorCircuit, editorDrawing, editorSymbol } = context;
		const { manifest } = project;
		const path = location.pathname;
		if (path !== "/editor" && path !== "/step" && path !== "/gerber") {
			previous.current = null;
			pending.current = null;
			return;
		}
		const activeFile =
			path === "/editor"
				? editorCircuit
					? manifest.circuits?.[
							project.circuits?.findIndex(
								(entry) => entry.circuit.id === editorCircuit.file.circuit.id,
							) ?? -1
						]?.circuit
					: editorSymbol
						? manifest.symbols[
								project.symbols.findIndex(
									(entry) => entry.id === editorSymbol.file.id,
								)
							]
						: editorDrawing
							? manifest.drawings?.[
									project.drawings?.findIndex(
										(entry) => entry.id === editorDrawing.file.id,
									) ?? -1
								]
							: manifest.drawing
				: context.selectedAsset?.kind === (path === "/step" ? "step" : "gerber")
					? context.selectedAsset.path
					: undefined;
		const activeView =
			path === "/editor" && editorCircuit ? "circuit" : undefined;
		const changedLocation = previous.current?.href !== location.href;
		const changedProject = previous.current?.session !== context.session;
		const initial = previous.current === null || changedProject;
		previous.current = { href: location.href, session: context.session };
		if (changedLocation || changedProject) {
			pending.current = null;
			if (file && (file !== activeFile || view !== activeView)) {
				if (path === "/editor") {
					const circuit = manifest.circuits?.find(
						(entry) => entry.circuit === file || entry.graph === file,
					);
					if (
						circuit &&
						(view === "circuit" ||
							(file !== manifest.drawing && !manifest.drawings?.includes(file)))
					) {
						pending.current = { file: circuit.circuit, view: "circuit" };
						void context.openCircuit(file).catch(() => {
							pending.current = null;
						});
						return;
					}
					if (
						file === manifest.drawing ||
						manifest.drawings?.includes(file) ||
						manifest.symbols.includes(file)
					) {
						pending.current = { file, view: undefined };
						context.selectEditorFile(file);
						return;
					}
				} else {
					const asset = manifest.assets.find(
						(entry) =>
							entry.path === file &&
							entry.kind === (path === "/step" ? "step" : "gerber"),
					);
					if (asset) {
						pending.current = { file, view: undefined };
						context.selectAsset(asset);
						return;
					}
				}
			}
		}
		if (
			pending.current &&
			(pending.current.file !== activeFile ||
				pending.current.view !== activeView)
		)
			return;
		pending.current = null;
		if (activeFile !== file || activeView !== view) {
			void navigate({
				to: path,
				search: (previous) => ({
					...previous,
					file: activeFile,
					view: activeView,
				}),
				replace: initial || !file,
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
	]);
}
