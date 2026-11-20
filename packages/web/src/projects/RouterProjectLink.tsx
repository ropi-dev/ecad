import { projectFileUrlPath } from "@ecad/core/projects/file-url.ts";
import type {
	ProjectLinkProps,
	ProjectPath,
} from "@ecad/core/projects/ProjectLink.tsx";
import { omit } from "solid-js";

export function createRouterProjectLink(
	navigate: (
		href: ProjectPath,
		file?: string,
		view?: "circuit" | "pcb",
	) => Promise<void>,
) {
	return function RouterProjectLink(props: ProjectLinkProps) {
		const rest = omit(props, "href", "file", "view", "onClick");
		return (
			<a
				{...rest}
				href={
					props.file
						? `${props.href}?${new URLSearchParams({ file: projectFileUrlPath(props.file), ...(props.view ? { view: props.view } : {}) })}`
						: props.href
				}
				onClick={(event) => {
					const onClick = props.onClick;
					if (typeof onClick === "function") onClick(event);
					else if (onClick) onClick[0](onClick[1], event);
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
					void navigate(
						props.href,
						props.file ? projectFileUrlPath(props.file) : undefined,
						props.view,
					);
				}}
			/>
		);
	};
}
