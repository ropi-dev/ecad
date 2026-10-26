import type {
	ProjectLinkProps,
	ProjectPath,
} from "@ecad/core/projects/ProjectLink.tsx";

export function createRouterProjectLink(
	navigate: (href: ProjectPath) => Promise<void>,
) {
	return function RouterProjectLink({
		href,
		onClick,
		...props
	}: ProjectLinkProps) {
		return (
			<a
				{...props}
				href={href}
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
					void navigate(href);
				}}
			/>
		);
	};
}
