import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppProjects } from "#/projects/AppProjects.tsx";
import { createRouterProjectLink } from "#/projects/RouterProjectLink.tsx";
import { routeTree } from "#/routeTree.gen.ts";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,

		Wrap: (props: { children: ReactNode }) => {
			return (
				<AppProjects LinkComponent={ProjectNavigationLink}>
					{props.children}
				</AppProjects>
			);
		},
	});

	const ProjectNavigationLink = createRouterProjectLink((href, file, view) =>
		router.navigate({ to: href, search: { file, view } }),
	);

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
