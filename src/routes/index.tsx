import { createFileRoute } from "@tanstack/react-router";
import { GerberWorkspace } from "../components/gerber/GerberWorkspace";

export const Route = createFileRoute("/")({ component: GerberWorkspace });
