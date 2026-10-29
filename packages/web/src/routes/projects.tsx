import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/projects")({
	beforeLoad: ({ location }) => {
		throw redirect({ href: `/${location.searchStr}`, replace: true });
	},
});
