import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import BetterSqlite3 from 'better-sqlite3'
import { Effect, Stream } from 'effect'
import { z } from 'zod'
import { Database, DatabaseError, insertDatabaseTodo, listDatabaseTodos, makeDatabaseLayer } from '#/db/index.ts'
import { runEffect } from '#/lib/effect.ts'
import { makeTodoRepository, TodoRepository, TodoStorageError } from '#/mcp-todos.ts'
import { createTodoEventStream, postTodo } from '#/services/server/todo-http.ts'
import { makeTrpcTodos } from '#/services/server/trpc-todos.ts'
import { trpcRouter } from '#/integrations/trpc/router.ts'
import { handleMcpRequest } from '#/utils/mcp-handler.ts'

const memoryStorage = (initial = '[]') => {
  let contents = initial
  return {
    read: async () => contents,
    write: async (_path: string, next: string) => {
      await delay(1)
      contents = next
    },
  }
}

test('todo repository serializes concurrent writes and persists every added todo', async () => {
  const storage = memoryStorage()
  const repository = await runEffect(makeTodoRepository('unused', storage))
  await runEffect(Effect.all(Array.from({ length: 8 }, (_, index) => repository.add(`Todo ${index}`)), { concurrency: 'unbounded' }))
  const todos = await runEffect(repository.list)
  assert.equal(todos.length, 8)
  assert.equal(new Set(todos.map((todo) => todo.id)).size, 8)
  assert.deepEqual(JSON.parse(await storage.read()), todos)
})

test('failed persistence keeps the previous todo state', async () => {
  const repository = await runEffect(makeTodoRepository('unused', {
    read: async () => '[{"id":4,"title":"Saved"}]',
    write: async () => { throw new Error('disk full') },
  }))
  await assert.rejects(runEffect(repository.add('Unsaved')), (error) => error instanceof TodoStorageError && error.operation === 'write')
  assert.deepEqual(await runEffect(repository.list), [{ id: 4, title: 'Saved' }])
})

test('todo repository validates existing data and saves atomically to its configured file', async () => {
  await assert.rejects(runEffect(makeTodoRepository('unused', memoryStorage('[{"id":"invalid","title":"Todo"}]'))), TodoStorageError)
  const directory = await mkdtemp(join(tmpdir(), 'ecad-todos-'))
  try {
    const path = join(directory, 'todos.json')
    const repository = await runEffect(makeTodoRepository(path))
    await runEffect(repository.add('Persisted'))
    const restored = await runEffect(makeTodoRepository(path))
    assert.deepEqual(await runEffect(restored.list), JSON.parse(await readFile(path, 'utf8')))
    assert.deepEqual(await readdir(directory), ['todos.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('POST validates JSON before changing the repository', async () => {
  const repository = await runEffect(makeTodoRepository('unused', memoryStorage()))
  const request = new Request('http://localhost/todos', { method: 'POST', body: '{"title":42}' })
  await assert.rejects(runEffect(postTodo(request).pipe(Effect.provideService(TodoRepository, repository))), /title is required/)
  assert.deepEqual(await runEffect(repository.list), [])
})

for (const mode of ['cancel', 'abort'] as const) {
  test(`SSE ${mode} releases its subscription and stops the heartbeat`, async () => {
    let subscribers = 0
    const changes = Stream.asyncScoped<ReadonlyArray<{ id: number; title: string }>>((emit) => Effect.acquireRelease(
      Effect.sync(() => {
        subscribers++
        void emit.single([{ id: 1, title: 'Subscribed' }])
      }),
      () => Effect.sync(() => { subscribers-- }),
    ))
    const controller = new AbortController()
    const reader = Stream.toReadableStream(createTodoEventStream(changes, controller.signal, 5)).getReader()
    while (!new TextDecoder().decode((await reader.read()).value).startsWith('data:')) {}
    assert.equal(subscribers, 1)
    if (mode === 'cancel') await reader.cancel()
    else {
      controller.abort()
      while (!(await reader.read()).done) {}
    }
    assert.equal(subscribers, 0)
    assert.equal((await reader.read()).done, true)
  })
}

function mcpFactory(delayMs: number, closed: () => void) {
  return () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' })
    server.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => {
      await delay(delayMs)
      return { content: [{ type: 'text', text }] }
    })
    const close = server.close.bind(server)
    server.close = async () => {
      closed()
      await close()
    }
    return server
  }
}

const mcpRequest = (id: number, signal?: AbortSignal) => new Request('http://localhost/mcp', {
  method: 'POST', signal,
  body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'echo', arguments: { text: `Reply ${id}` } } }),
})

test('MCP awaits real responses and isolates simultaneous server connections', async () => {
  let closed = 0
  const factory = mcpFactory(35, () => { closed++ })
  const responses = await Promise.all([handleMcpRequest(mcpRequest(1), factory), handleMcpRequest(mcpRequest(2), factory)])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  assert.deepEqual(bodies.map((body) => body.id), [1, 2])
  assert.deepEqual(bodies.map((body) => body.result.content[0].text), ['Reply 1', 'Reply 2'])
  assert.equal(closed, 2)
})

test('MCP timeout and request cancellation close the server', async () => {
  let closed = 0
  const factory = mcpFactory(100, () => { closed++ })
  const timedOut = await handleMcpRequest(mcpRequest(1), factory, { timeoutMs: 5 })
  assert.equal(timedOut.status, 504)
  assert.equal((await timedOut.json()).id, 1)
  assert.equal(closed, 1)
  const controller = new AbortController()
  const pending = handleMcpRequest(mcpRequest(2, controller.signal), factory)
  await delay(5)
  controller.abort()
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === 'AbortError')
  assert.equal(closed, 2)
})

test('MCP rejects malformed JSON and acknowledges notifications without waiting for replies', async () => {
  let closed = 0
  const factory = mcpFactory(0, () => { closed++ })
  const malformed = await handleMcpRequest(new Request('http://localhost/mcp', { method: 'POST', body: '{' }), factory)
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error.code, -32700)
  assert.equal(closed, 0)
  const notification = await handleMcpRequest(new Request('http://localhost/mcp', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }), factory)
  assert.equal(notification.status, 202)
  assert.equal(closed, 1)
})

test('MCP closes both transports after connection failure even if server cleanup fails', async () => {
  let clientClosed = false
  let transportClosed = false
  const response = await handleMcpRequest(mcpRequest(1), () => {
    const server = new McpServer({ name: 'failure', version: '1.0.0' })
    server.connect = async () => { throw new Error('connect failed') }
    server.close = async () => { throw new Error('close failed') }
    return server
  }, {
    createTransports: () => {
      const [client, server] = InMemoryTransport.createLinkedPair()
      client.onclose = () => { clientClosed = true }
      server.onclose = () => { transportClosed = true }
      return [client, server]
    },
  })
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.equal(body.error.message, 'MCP request failed')
  assert.equal(body.id, 1)
  assert.equal(clientClosed, true)
  assert.equal(transportClosed, true)
})

test('MCP releases its server when transport acquisition fails', async () => {
  let closed = 0
  const response = await handleMcpRequest(mcpRequest(9), mcpFactory(0, () => { closed++ }), {
    createTransports: () => { throw new Error('Cannot create transport') },
  })
  assert.equal(response.status, 500)
  assert.equal((await response.json()).id, 9)
  assert.equal(closed, 1)
})

test('database service acquires lazily and closes after successful and failed queries', async () => {
  const connections: BetterSqlite3.Database[] = []
  const layer = makeDatabaseLayer(':memory:', (filename) => {
    const client = new BetterSqlite3(filename)
    connections.push(client)
    client.exec('CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()))')
    return client
  })
  assert.equal(connections.length, 0)
  const results = await runEffect(Effect.gen(function* () {
    yield* insertDatabaseTodo('Stored')
    return yield* listDatabaseTodos
  }).pipe(Effect.provide(layer)))
  assert.equal(results[0].title, 'Stored')
  assert.equal(connections[0].open, false)
  let failedClient: BetterSqlite3.Database | undefined
  await assert.rejects(runEffect(listDatabaseTodos.pipe(Effect.provide(makeDatabaseLayer(':memory:', (filename) => {
    failedClient = new BetterSqlite3(filename)
    return failedClient
  })))), (error) => error instanceof DatabaseError && error.operation === 'query')
  assert.equal(failedClient?.open, false)
})

test('database scope closes when its request is interrupted', async () => {
  const controller = new AbortController()
  let acquired!: () => void
  const ready = new Promise<void>((resolve) => { acquired = resolve })
  let client: BetterSqlite3.Database | undefined
  const operation = Effect.gen(function* () {
    yield* Database
    acquired()
    yield* Effect.never
  }).pipe(Effect.provide(makeDatabaseLayer(':memory:', (filename) => {
    client = new BetterSqlite3(filename)
    return client
  })))
  const pending = runEffect(operation, controller.signal)
  await ready
  controller.abort()
  await assert.rejects(pending)
  assert.equal(client?.open, false)
})

test('tRPC repository preserves all concurrent updates and maps validation failures', async () => {
  const repository = await runEffect(makeTrpcTodos())
  await runEffect(Effect.all([repository.add('First'), repository.add('Second')], { concurrency: 'unbounded' }))
  assert.deepEqual(await runEffect(repository.list), [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }])
  await assert.rejects(trpcRouter.createCaller({}).todos.add({ name: ' ' }), (error: unknown) => (
    error instanceof Error && 'code' in error && error.code === 'BAD_REQUEST'
  ))
})
