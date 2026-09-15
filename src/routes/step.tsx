import { createFileRoute } from "@tanstack/react-router";
import { StepWorkspace } from "../components/step/StepWorkspace";

export const Route = createFileRoute("/step")({
	component: StepWorkspace,
	head: () => ({
		meta: [
			{ title: "STEP viewer" },
			{
				name: "description",
				content: "View STEP models in 3D, locally in your browser.",
			},
		],
	}),
});
