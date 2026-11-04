import type { ReactNode } from "react";
import { useButtonShortcuts } from "#/components/viewer/useButtonShortcuts.ts";
import { ProjectConflictNotice } from "#/projects/ProjectConflictNotice.tsx";
import { ProjectFilesSidebar } from "#/projects/ProjectFilesSidebar.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";

export function ProjectShell({
	children,
	sidebar = <ProjectFilesSidebar />,
}: {
	children: ReactNode;
	sidebar?: ReactNode;
}) {
	useButtonShortcuts();
	const project = useProject();
	return (
		<div
			aria-busy={project?.busy}
			inert={project?.busy}
			className="relative flex h-dvh overflow-hidden bg-[#131518] text-[#e8e9ec]"
		>
			{sidebar}
			<div key={project?.session} className="min-w-0 flex-1 overflow-auto">
				{children}
			</div>
			<ProjectConflictNotice />
		</div>
	);
}
