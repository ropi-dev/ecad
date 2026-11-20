import type { JSX } from "@solidjs/web";
import { children, Loading, lazy } from "solid-js";
import { Keyed } from "#/components/ui/Keyed.tsx";
import { Toaster } from "#/components/ui/Toaster.tsx";
import { useButtonShortcuts } from "#/components/viewer/useButtonShortcuts.ts";
import { useDebugStats } from "#/performance/useDebugStats.ts";
import { ProjectConflictNotice } from "#/projects/ProjectConflictNotice.tsx";
import { ProjectFilesSidebar } from "#/projects/ProjectFilesSidebar.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";
import "#/settings/theme.ts";

const DebugStats = lazy(() => import("#/performance/DebugStats.tsx"));

export function ProjectShell(props: {
	children: JSX.Element;
	/** Quits the app. The sidebar shows an Exit button when it is given. */
	onExit?: () => void;
	sidebar?: JSX.Element;
}) {
	useButtonShortcuts();
	const debugStats = useDebugStats();
	const project = useProjectSelection(({ busy, session }) => ({
		busy,
		session,
	}));
	const sidebar = children(() => props.sidebar);
	const busy = () => {
		const value = project()?.busy;
		return value === undefined ? undefined : value ? "true" : "false";
	};
	return (
		<div
			aria-busy={busy()}
			inert={project()?.busy}
			class="relative flex h-dvh overflow-hidden bg-app text-fg"
		>
			{sidebar() !== undefined ? (
				sidebar()
			) : (
				<ProjectFilesSidebar onExit={props.onExit} />
			)}
			<Keyed key={project()?.session}>
				<div class="min-w-0 flex-1 overflow-auto">{props.children}</div>
			</Keyed>
			<ProjectConflictNotice />
			<Toaster />
			{debugStats() && (
				<Loading fallback={null}>
					<DebugStats />
				</Loading>
			)}
		</div>
	);
}
