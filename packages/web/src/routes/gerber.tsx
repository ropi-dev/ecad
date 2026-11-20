import { GerberWorkspace } from "@ecad/core/components/gerber/GerberWorkspace.tsx";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/gerber")({ component: GerberWorkspace });
