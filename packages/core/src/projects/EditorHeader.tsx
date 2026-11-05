import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { ReactNode } from "react";
import { McpControls } from "#/components/editor/McpControls.tsx";
import { ProjectLink } from "#/projects/ProjectLink.tsx";
export function EditorHeader({
	headerControls,
	registered,
	enableMcp,
	store,
}: {
	headerControls?: ReactNode;
	registered: boolean;
	enableMcp: boolean;
	store: ReturnType<typeof createDrawingStore>;
}) {
	return (
		<>
			{" "}
			{(headerControls || !registered) && (
				<header className="absolute top-10 left-10 z-4 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-2 max-[600px]:top-9 max-[600px]:left-9 max-[600px]:max-w-[calc(100%-4.5rem)]">
					{headerControls ?? (
						<>
							<ProjectLink
								href="/gerber"
								className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] no-underline shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] focus-visible:outline-2 focus-visible:outline-amber-200"
							>
								Gerber viewer
							</ProjectLink>
							<ProjectLink
								href="/step"
								className="relative inline-flex cursor-pointer items-center gap-[7px] rounded-lg border border-[#414955] bg-[#1b1e24ed] px-3 py-[9px] text-[12px] font-medium text-[#e8edf5] no-underline shadow-[0_4px_16px_#0003] hover:bg-[#303741] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#e8b77e] focus-visible:outline-2 focus-visible:outline-amber-200"
							>
								STEP viewer
							</ProjectLink>
							<ProjectLink
								href="/"
								className="inline-flex min-h-10 items-center rounded-lg border border-white/20 bg-slate-900 px-3 text-sm text-white/90 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-white"
							>
								Workspace
							</ProjectLink>
							{enableMcp && <McpControls store={store} />}
						</>
					)}
				</header>
			)}
		</>
	);
}
