import { createFileRoute } from "@tanstack/react-router";
import { GerberWorkspace } from "@ecad/core/components/gerber/GerberWorkspace.tsx";

export const Route = createFileRoute("/")({ component: GerberWorkspace });
