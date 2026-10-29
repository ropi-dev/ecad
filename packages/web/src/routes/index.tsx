import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceStart } from "@ecad/core/projects/WorkspaceStart.tsx";

export const Route = createFileRoute("/")({ component: WorkspaceStart });
