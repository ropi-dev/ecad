import { WorkspaceStart } from "@ecad/core/projects/WorkspaceStart.tsx";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: WorkspaceStart });
