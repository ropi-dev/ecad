import { ProjectShell } from "@ecad/core/projects/ProjectShell.tsx";
import appCss from "@ecad/core/styles.css?url";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { AppWorkspace } from "#/projects/AppProjects.tsx";

export const Route = createRootRoute({
	validateSearch: (
		search: Record<string, unknown>,
	): { file?: string; view?: "circuit" } => ({
		file: typeof search.file === "string" ? search.file : undefined,
		view: search.view === "circuit" ? "circuit" : undefined,
	}),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "ECAD" },
			{
				name: "description",
				content: "Create drawings, circuits, and symbols.",
			},
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
	component: AppWorkspace,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<ProjectShell
					sidebar={<div id="project-sidebar" className="contents" />}
				>
					{children}
				</ProjectShell>
				<Scripts />
			</body>
		</html>
	);
}
