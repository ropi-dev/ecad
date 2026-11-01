import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import type { ReactNode } from "react";
import TanstackQueryProvider, {
	getContext,
} from "./integrations/tanstack-query/root-provider";
import { AppProjects } from "./projects/AppProjects";
import { createRouterProjectLink } from "./projects/RouterProjectLink";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();

	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,

		Wrap: (props: { children: ReactNode }) => {
			return (
				<AppProjects LinkComponent={ProjectNavigationLink}>
					<TanstackQueryProvider context={context}>
						{props.children}
					</TanstackQueryProvider>
				</AppProjects>
			);
		},
	});

	const ProjectNavigationLink = createRouterProjectLink((href, file, view) =>
		router.navigate({ to: href, search: { file, view } }),
	);

	setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
