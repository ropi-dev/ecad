import { projectFileUrlPath } from "@ecad/core/projects/file-url.ts";
import type {
	ProjectLinkProps,
	ProjectPath,
} from "@ecad/core/projects/ProjectLink.tsx";
import { usePostHog } from "@posthog/react";

export function createRouterProjectLink(
	navigate: (
		href: ProjectPath,
		file?: string,
		view?: "circuit" | "pcb",
	) => Promise<void>,
) {
	return function RouterProjectLink({
		href,
		file,
		view,
		onClick,
		...props
	}: ProjectLinkProps) {
		const posthog = usePostHog();

		return (
			<a
				{...props}
				href={
					file
						? `${href}?${new URLSearchParams({ file: projectFileUrlPath(file), ...(view ? { view } : {}) })}`
						: href
				}
				onClick={(event) => {
					onClick?.(event);
					if (
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey ||
						(props.target && props.target !== "_self") ||
						props.download !== undefined
					)
						return;
					event.preventDefault();
					if (file) {
						const editorView = view ?? "editor";
						posthog.capture("project_file_opened", {
							view: editorView,
						});
					}
					void navigate(
						href,
						file ? projectFileUrlPath(file) : undefined,
						view,
					);
				}}
			/>
		);
	};
}
