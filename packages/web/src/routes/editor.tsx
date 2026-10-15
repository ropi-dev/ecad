import { createFileRoute } from "@tanstack/react-router";
import { Editor2D } from "@ecad/core/components/editor/Editor2D.tsx";

export const Route = createFileRoute("/editor")({
	component: Editor2D,
	head: () => ({
		meta: [
			{ title: "Schematic editor" },
			{
				name: "description",
				content: "Place and move shapes on a landscape A3 sheet.",
			},
		],
	}),
});
