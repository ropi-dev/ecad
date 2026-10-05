import { ProjectPage } from "@ecad/core/projects/ProjectPage.tsx";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/projects")({
	component: ProjectPage,
	head: () => ({ meta: [{ title: "Projects | ECAD" }] }),
});
