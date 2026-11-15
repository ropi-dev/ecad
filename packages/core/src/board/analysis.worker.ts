import { type AnalysisRequest, createBoardAnalysis } from "#/board/analysis.ts";

const analyse = createBoardAnalysis();

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
	const reply = analyse(event.data);
	if (!reply) return;
	self.postMessage(reply, {
		transfer:
			reply.type === "fills"
				? reply.fills.map((fill) => fill.triangles.buffer)
				: [],
	});
};
