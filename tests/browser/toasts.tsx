import { Effect } from "effect";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "#/components/ui/Toaster.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { useFileImport } from "#/components/viewer/useFileImport.ts";
import { InvalidFile } from "#/formats/import-effects.ts";
import { required } from "../helpers/required.ts";
import "#/styles.css";

export { toastManager };

toastManager.add({ type: "info", title: "Ready before mount" });
const parse = (file: File) =>
	file.name.endsWith(".bad")
		? Effect.fail(new InvalidFile({ message: "Invalid file contents" }))
		: Effect.succeed({ value: file.name });

function ImportFixture() {
	const { readFiles } = useFileImport(parse);
	const [count, setCount] = useState(0);
	return (
		<>
			<input
				type="file"
				multiple
				aria-label="Import test files"
				onChange={(event) => {
					void readFiles(Array.from(event.target.files ?? []), (values) =>
						setCount(values.length),
					);
				}}
			/>
			<output aria-label="Imported count">{count}</output>
		</>
	);
}

createRoot(required(document.getElementById("root"))).render(
	<>
		<input aria-label="Drawing name" />
		<ImportFixture />
		<Toaster />
	</>,
);
