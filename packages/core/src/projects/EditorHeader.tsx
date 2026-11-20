import type { JSX } from "@solidjs/web";
import { children, Show } from "solid-js";
import { ProjectLink } from "#/projects/ProjectLink.tsx";

/** Shared look of the links that head a workspace opened without a project. */
export const workspaceLinkClassName = "ui-button bg-panel shadow-panel";

/**
 * Header for an editor used on its own, without a project. Inside a project
 * the document bar takes this place.
 */
export function EditorHeader(props: { headerControls?: JSX.Element }) {
	const controls = children(() => props.headerControls);
	return (
		<header class="absolute top-[var(--chrome-top)] left-[var(--chrome-gap)] z-4 flex max-w-[calc(100%-2*var(--chrome-gap))] flex-wrap items-center gap-2">
			<Show
				when={controls()}
				fallback={
					<>
						<ProjectLink
							href="/gerber"
							class={workspaceLinkClassName}
							data-variant="secondary"
							data-size="md"
						>
							Gerber viewer
						</ProjectLink>
						<ProjectLink
							href="/step"
							class={workspaceLinkClassName}
							data-variant="secondary"
							data-size="md"
						>
							STEP viewer
						</ProjectLink>
						<ProjectLink
							href="/"
							class={workspaceLinkClassName}
							data-variant="secondary"
							data-size="md"
						>
							Workspace
						</ProjectLink>
					</>
				}
			>
				{controls()}
			</Show>
		</header>
	);
}
