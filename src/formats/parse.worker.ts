import { parsers } from "./registry";

self.onmessage = (
	event: MessageEvent<{ id: number; source: string; filename: string }>,
) => {
	const { id, source, filename } = event.data;
	try {
		self.postMessage({ id, result: parsers.parse(source, filename) });
	} catch (error) {
		self.postMessage({
			id,
			error:
				error instanceof Error ? error.message : "Unable to parse this file.",
		});
	}
};
