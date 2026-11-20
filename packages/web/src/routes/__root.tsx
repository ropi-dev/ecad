import copperE from "@ecad/core/assets/copper-e.svg?url";
import { ProjectShell } from "@ecad/core/projects/ProjectShell.tsx";
import { SETTINGS_STORAGE_KEY } from "@ecad/core/settings/store.ts";
import appCss from "@ecad/core/styles.css?url";
import type { JSX } from "@solidjs/web";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/solid-router";
import { AppWorkspace } from "#/projects/AppProjects.tsx";

const themeScript = `(()=>{let t;try{t=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)})).theme}catch{}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"})()`;

export const Route = createRootRoute({
	validateSearch: (
		search: Record<string, unknown>,
	): { file?: string; view?: "circuit" | "pcb" } => ({
		file: typeof search.file === "string" ? search.file : undefined,
		view:
			search.view === "circuit" || search.view === "pcb"
				? search.view
				: undefined,
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
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "icon", type: "image/svg+xml", href: copperE },
		],
		scripts: [
			{ children: themeScript },
			{
				// The deployed CSP blocks eval, so zod cannot compile parsers. Turn its
				// JIT off before any schema is defined, or its `new Function` probe is
				// reported as a CSP violation. This runs before the module scripts.
				children: "globalThis.__zod_globalConfig={jitless:true}",
			},
		],
	}),
	shellComponent: RootDocument,
	component: AppWorkspace,
});

function RootDocument(props: { children: JSX.Element }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<ProjectShell sidebar={<div id="project-sidebar" class="contents" />}>
					{props.children}
				</ProjectShell>
				<Scripts />
			</body>
		</html>
	);
}
