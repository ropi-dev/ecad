import assert from "node:assert/strict";
import test from "node:test";
import { runEffect } from "@ecad/drawing-core/lib/effect.ts";
import { Effect, ParseResult, Schema } from "effect";
import {
	HttpClient,
	HttpError,
	makeHttpClient,
	requestJson,
} from "#/lib/http.ts";

const schema = Schema.Struct({ value: Schema.Number });
const request = (fetcher: typeof fetch) =>
	requestJson("/test", schema).pipe(
		Effect.provideService(HttpClient, makeHttpClient(fetcher)),
	);

test("HTTP errors distinguish status failures, malformed JSON and invalid data", async () => {
	await assert.rejects(
		runEffect(request(async () => new Response("Not found", { status: 404 }))),
		(error) => error instanceof HttpError && error.status === 404,
	);
	await assert.rejects(
		runEffect(request(async () => new Response("{"))),
		(error) =>
			error instanceof HttpError &&
			error.status === undefined &&
			error.cause instanceof SyntaxError,
	);
	await assert.rejects(
		runEffect(request(async () => Response.json({ value: "wrong" }))),
		(error) =>
			error instanceof HttpError &&
			error.status === undefined &&
			ParseResult.isParseError(error.cause),
	);
});
