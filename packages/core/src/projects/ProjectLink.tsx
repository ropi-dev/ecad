import type { ComponentProps } from "react";
import { useProject } from "#/projects/ProjectProvider.tsx";

export type ProjectPath = "/gerber" | "/editor" | "/" | "/step";
export type ProjectLinkProps = Omit<ComponentProps<"a">, "href"> & {
	href: ProjectPath;
	file?: string;
	view?: "circuit";
};

export function ProjectLink(props: ProjectLinkProps) {
	const Link = useProject()?.LinkComponent ?? "a";
	const { file, view, ...linkProps } = props;
	return Link === "a" ? <a {...linkProps} /> : <Link {...props} />;
}
