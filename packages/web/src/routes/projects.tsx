import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/projects")({
	beforeLoad: ({ location }) => {
		throw redirect({ href: `/${location.searchStr}`, replace: true });
	},
});
