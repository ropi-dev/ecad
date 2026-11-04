import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	createLocalDrawingSession,
	type LocalDrawingOptions,
} from "./drawing.ts";

export async function createLocalClient(options: LocalDrawingOptions) {
	const { server, settled } = createLocalDrawingSession(options);
	const client = new Client({ name: "ecad-cli", version: "0.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		return {
			client,
			async close() {
				await client.close();
				await server.close();
				await settled();
			},
		};
	} catch (error) {
		await client.close();
		await server.close();
		await settled();
		throw error;
	}
}
