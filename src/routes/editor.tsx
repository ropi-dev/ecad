import { createFileRoute } from "@tanstack/react-router";
import { Editor2D } from "../components/editor/Editor2D";

export const Route = createFileRoute("/editor")({
	component: Editor2D,
	head: () => ({
		meta: [
			{ title: "2D shape editor" },
			{
				name: "description",
				content: "Place and move shapes on a landscape A3 sheet.",
			},
		],
	}),
});
