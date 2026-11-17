import {
	type AnalysisReply,
	type AnalysisRequest,
	createBoardAnalysis,
} from "#/board/analysis.ts";

const analyse = createBoardAnalysis();

const post = (reply: AnalysisReply) =>
	self.postMessage(reply, {
		transfer:
			reply.type === "fills"
				? reply.fills.map((fill) => fill.triangles.buffer)
				: reply.type === "fabrication"
					? [reply.archive.buffer]
					: [],
	});

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
	const reply = analyse(event.data);
	if (reply instanceof Promise) void reply.then(post);
	else if (reply) post(reply);
};
