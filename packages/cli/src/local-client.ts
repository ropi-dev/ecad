import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	createLocalDrawingMcpServer,
	type LocalDrawingOptions,
} from "./drawing.ts";

export async function createLocalClient(options: LocalDrawingOptions) {
	const server = createLocalDrawingMcpServer(options);
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
			},
		};
	} catch (error) {
		await client.close();
		await server.close();
		throw error;
	}
}
