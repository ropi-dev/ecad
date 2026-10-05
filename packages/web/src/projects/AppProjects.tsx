import { PerformanceBoundary } from "@ecad/core/performance/PerformanceBoundary.tsx";
import { ProjectProvider } from "@ecad/core/projects/ProjectProvider.tsx";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { RouterProjectLink } from "#/projects/RouterProjectLink.tsx";
import { createWebProjectStorage } from "#/projects/storage.ts";
import { createWebSymbolLibraryStorage } from "#/symbol-library/storage.ts";

const projectStorage = createWebProjectStorage();
const symbolStorage = createWebSymbolLibraryStorage();

export function AppProjects() {
	const path = useRouterState({
		select: (state) =>
			state.resolvedLocation?.pathname ?? state.location.pathname,
	});
	return (
		<ProjectProvider
			storage={projectStorage}
			symbolStorage={symbolStorage}
			LinkComponent={RouterProjectLink}
		>
			<PerformanceBoundary
				name={path === "/" ? "gerber" : path.slice(1)}
				path={path}
			>
				<Outlet />
			</PerformanceBoundary>
		</ProjectProvider>
	);
}
