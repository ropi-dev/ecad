import { StepWorkspace } from "@ecad/core/components/step/StepWorkspace.tsx";
import { createFileRoute } from "@tanstack/react-router";

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
