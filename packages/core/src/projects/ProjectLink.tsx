import type { ComponentProps } from "react";
import { useProject } from "#/projects/ProjectProvider.tsx";

export type ProjectPath = "/gerber" | "/editor" | "/" | "/step";
export type ProjectLinkProps = Omit<ComponentProps<"a">, "href"> & {
	href: ProjectPath;
};

export function ProjectLink(props: ProjectLinkProps) {
	const Link = useProject()?.LinkComponent ?? "a";
	return <Link {...props} />;
}
