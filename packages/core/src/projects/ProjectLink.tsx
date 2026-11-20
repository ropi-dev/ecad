import type { JSX } from "@solidjs/web";
import { Dynamic } from "@solidjs/web";
import { omit, Show } from "solid-js";
import { useProjectActions } from "#/projects/ProjectProvider.tsx";

export type ProjectPath = "/gerber" | "/editor" | "/" | "/step";
export type ProjectLinkProps = Omit<
	JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
	"href"
> & {
	href: ProjectPath;
	file?: string;
	view?: "circuit" | "pcb";
};

export function ProjectLink(props: ProjectLinkProps) {
	const actions = useProjectActions();
	return (
		<Show
			when={actions()?.LinkComponent}
			fallback={<a {...omit(props, "file", "view")} />}
		>
			{(Link) => <Dynamic component={Link()} {...props} />}
		</Show>
	);
}
