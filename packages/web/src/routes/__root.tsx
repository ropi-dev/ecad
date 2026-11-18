import { ProjectShell } from "@ecad/core/projects/ProjectShell.tsx";
import { SETTINGS_STORAGE_KEY } from "@ecad/core/settings/store.ts";
import appCss from "@ecad/core/styles.css?url";
import {
	createRootRoute,
	HeadContent,
	ScriptOnce,
	Scripts,
} from "@tanstack/react-router";
import { PostHogProvider } from "@posthog/react";
import { AppWorkspace } from "#/projects/AppProjects.tsx";

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
		links: [{ rel: "stylesheet", href: appCss }],
		scripts: [
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

const themeScript = `(()=>{let t;try{t=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)})).theme}catch{}document.documentElement.dataset.theme=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"})()`;

const posthogToken = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;
const posthogConfigured = posthogToken && posthogHost;

if (import.meta.env.DEV && typeof window !== "undefined") {
	if (!posthogToken) {
		throw new Error(
			"VITE_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
		);
	}
	if (!posthogHost) {
		throw new Error(
			"VITE_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_PUBLIC_POSTHOG_HOST is configured",
		);
	}
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const app = (
		<ProjectShell
			sidebar={<div id="project-sidebar" className="contents" />}
		>
			{children}
		</ProjectShell>
	);

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<ScriptOnce>{themeScript}</ScriptOnce>
				<HeadContent />
			</head>
			<body>
				{posthogConfigured ? (
					<PostHogProvider
						apiKey={posthogToken}
						options={{
							api_host: "/ingest",
							capture_exceptions: true,
							debug: import.meta.env.DEV,
						}}
					>
						{app}
					</PostHogProvider>
				) : (
					app
				)}
				<Scripts />
			</body>
		</html>
	);
}
