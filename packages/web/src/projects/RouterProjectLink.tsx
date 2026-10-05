import type { ProjectLinkProps } from "@ecad/core/projects/ProjectLink.tsx";
import { Link } from "@tanstack/react-router";

export function RouterProjectLink({ href, ...props }: ProjectLinkProps) {
	return <Link to={href} {...props} />;
}
