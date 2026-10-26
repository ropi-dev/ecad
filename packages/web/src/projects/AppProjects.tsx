import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
import { ProjectFilesSidebar } from "@ecad/core/projects/ProjectFilesSidebar.tsx";
import type { ProjectLinkProps } from "@ecad/core/projects/ProjectLink.tsx";
import {
	ProjectProvider,
	useProject,
} from "@ecad/core/projects/ProjectProvider.tsx";
import { Outlet, useRouterState } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
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
	const path = useRouterState({
		select: (state) =>
			state.resolvedLocation?.pathname ?? state.location.pathname,
	});
	return (
		<PerformanceBoundary
			name={path === "/" ? "gerber" : path.slice(1)}
			path={path}
		>
			<Outlet />
		</PerformanceBoundary>
	);
}
