import type { createDrawingStore } from "@ecad/drawing-core/commands/drawing-store.ts";
import type { ReactNode } from "react";
import { McpControls } from "#/components/editor/McpControls.tsx";
import { ProjectLink } from "#/projects/ProjectLink.tsx";

/** Shared look of the links that head a workspace opened without a project. */
export const workspaceLinkClassName = "ui-button bg-panel shadow-panel";

/**
 * Header for an editor used on its own, without a project. Inside a project
 * the document bar takes this place.
 */
export function EditorHeader({
	headerControls,
	enableMcp,
	store,
}: {
	headerControls?: ReactNode;
	enableMcp: boolean;
	store: ReturnType<typeof createDrawingStore>;
}) {
	return (
		<header className="absolute top-[var(--chrome-top)] left-[var(--chrome-gap)] z-4 flex max-w-[calc(100%-2*var(--chrome-gap))] flex-wrap items-center gap-2">
			{headerControls ?? (
				<>
					<ProjectLink
						href="/gerber"
						className={workspaceLinkClassName}
						data-variant="secondary"
						data-size="md"
					>
						Gerber viewer
					</ProjectLink>
					<ProjectLink
						href="/step"
						className={workspaceLinkClassName}
						data-variant="secondary"
						data-size="md"
					>
						STEP viewer
					</ProjectLink>
					<ProjectLink
						href="/"
						className={workspaceLinkClassName}
						data-variant="secondary"
						data-size="md"
					>
						Workspace
					</ProjectLink>
					{enableMcp && <McpControls store={store} />}
				</>
			)}
		</header>
	);
}
