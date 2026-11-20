import type { JSX } from "@solidjs/web";
import { createRouter as createTanStackRouter } from "@tanstack/solid-router";
import { AppProjects } from "#/projects/AppProjects.tsx";
import { createRouterProjectLink } from "#/projects/RouterProjectLink.tsx";
import { routeTree } from "#/routeTree.gen.ts";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,

		Wrap: (props: { children: JSX.Element }) => {
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

declare module "@tanstack/solid-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
