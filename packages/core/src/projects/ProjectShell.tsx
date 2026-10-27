import type { ReactNode } from "react";
import { ProjectFilesSidebar } from "#/projects/ProjectFilesSidebar.tsx";
import { useProject } from "#/projects/ProjectProvider.tsx";

export function ProjectShell({
	children,
	sidebar = <ProjectFilesSidebar />,
}: {
	children: ReactNode;
	sidebar?: ReactNode;
}) {
	const project = useProject();
	return (
		<div
			aria-busy={project?.busy}
			inert={project?.busy}
			className="relative flex h-dvh overflow-hidden bg-[#131518] pl-3 text-[#e8e9ec]"
		>
			{sidebar}
			<div key={project?.session} className="min-w-0 flex-1 overflow-auto">
				{children}
			</div>
		</div>
	);
}
