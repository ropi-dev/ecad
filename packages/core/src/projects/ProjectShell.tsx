import { lazy, type ReactNode, Suspense } from "react";
import { Toaster } from "#/components/ui/Toaster.tsx";
import { useButtonShortcuts } from "#/components/viewer/useButtonShortcuts.ts";
import { useDebugStats } from "#/performance/useDebugStats.ts";
import { ProjectConflictNotice } from "#/projects/ProjectConflictNotice.tsx";
import { ProjectFilesSidebar } from "#/projects/ProjectFilesSidebar.tsx";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

const DebugStats = lazy(() => import("#/performance/DebugStats.tsx"));

export function ProjectShell({
	children,
	onExit,
	sidebar = <ProjectFilesSidebar onExit={onExit} />,
}: {
	children: ReactNode;
	/** Quits the app. The sidebar shows an Exit button when it is given. */
	onExit?: () => void;
	sidebar?: ReactNode;
}) {
	useButtonShortcuts();
	const debugStats = useDebugStats();
	const project = useProjectSelection(({ busy, session }) => ({
		busy,
		session,
	}));
	return (
		<div
			aria-busy={project?.busy}
			inert={project?.busy}
			className="relative flex h-dvh overflow-hidden bg-app text-fg"
		>
			{sidebar}
			<div key={project?.session} className="min-w-0 flex-1 overflow-auto">
				{children}
			</div>
			<ProjectConflictNotice />
			<Toaster />
			{debugStats && (
				<Suspense fallback={null}>
					<DebugStats />
				</Suspense>
			)}
		</div>
	);
}
