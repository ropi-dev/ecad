import { createFileRoute } from "@tanstack/react-router";
import { GerberViewer } from "../components/viewer/GerberViewer";

export const Route = createFileRoute("/")({ component: GerberViewer });
