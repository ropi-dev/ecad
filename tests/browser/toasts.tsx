import { render } from "@solidjs/web";
import { Toaster } from "#/components/ui/Toaster.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { required } from "../helpers/required.ts";
import "#/styles.css";

export { toastManager };

toastManager.add({ type: "info", title: "Ready before mount" });

render(
	() => (
		<>
			<input aria-label="Drawing name" />
			<Toaster />
		</>
	),
	required(document.getElementById("root")),
);
