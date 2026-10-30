import { createTestCircuit } from "./fixtures/circuit.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeCircuitGraph, buildCircuitGraph } from "@ecad/drawing-core/circuit/graph.ts";
import { circuitFileSchema, createCircuit, parseCircuit, parseGraphLayout, serializeCircuit, serializeGraphLayout } from "@ecad/drawing-core/circuit/model.ts";
import { createCircuitComponent, instantiateCircuitPart } from "@ecad/drawing-core/circuit/parts.ts";
import { createCircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { createCircuitView, untangleCircuitGraph, circuitLayoutQuality } from "@ecad/drawing-core/circuit/untangle.ts";
import { parseProjectManifest, serializeProjectManifest } from "#/projects/format.ts";
import { ProjectRepository, type ProjectDirectory } from "#/projects/repository.ts";

test("circuit and graph formats round trip independently and reject broken references", () => {
	const file = createTestCircuit();
	assert.deepEqual(parseCircuit(serializeCircuit(file.circuit)), file.circuit);
	assert.deepEqual(parseGraphLayout(serializeGraphLayout(file.graph)), file.graph);
	assert.ok(!serializeCircuit(file.circuit).includes('"positions"'));
	assert.throws(() => parseCircuit(JSON.stringify({ ...file.circuit, version: 2 })));
	assert.throws(() => circuitFileSchema.parse({ ...file, graph: { ...file.graph, circuitId: "other" } }));
	assert.throws(() => circuitFileSchema.parse({ ...file, graph: { ...file.graph, positions: [{ id: "missing", kind: "component", x: 0, y: 0 }] } }));
	const broken = structuredClone(file);
	broken.circuit.nets[0].pinIds.push(broken.circuit.nets[1].pinIds[0]);
	assert.throws(() => circuitFileSchema.parse(broken));
	broken.circuit.nets[0].pinIds = ["missing"];
	assert.throws(() => circuitFileSchema.parse(broken));
});

test("moving every graph node preserves the entire circuit, including identities", () => {
	const file = createTestCircuit();
	const store = createCircuitStore(file);
	store.execute({ type: "move", positions: file.graph.positions.map((position) => ({ ...position, x: position.x + 42, y: position.y - 30 })) });
	assert.deepEqual(store.getSnapshot().circuit, file.circuit);
	assert.notDeepEqual(store.getSnapshot().graph, file.graph);
	store.undo();
	assert.deepEqual(store.getSnapshot().graph, file.graph);
	store.redo();
	assert.deepEqual(store.getSnapshot().circuit, file.circuit);
});

test("net merges preserve aliases and survivor identity without retaining edge identity", () => {
	const file = createTestCircuit();
	const store = createCircuitStore(file);
	const [first, second] = file.circuit.nets;
	store.execute({ type: "connect", pinIds: [second.pinIds[0]], netId: first.id });
	const merged = store.getSnapshot().circuit.nets.find((net) => net.id === first.id)!;
	assert.deepEqual(merged.names, ["3V3", "LED_DRIVE"]);
	assert.deepEqual(new Set(merged.pinIds), new Set([...first.pinIds, ...second.pinIds]));
	assert.equal(store.getSnapshot().circuit.nets.length, file.circuit.nets.length - 1);
	assert.ok(!store.getSnapshot().graph.positions.some((position) => position.id === second.id));
	store.execute({ type: "connect", pinIds: [...merged.pinIds] });
	assert.equal(store.getSnapshot().circuit.nets.length, file.circuit.nets.length - 1);
	assert.equal(store.getSnapshot().circuit.nets.find((net) => net.id === first.id)?.pinIds.length, first.pinIds.length + second.pinIds.length);
});

test("splitting keeps selected pins connected while disconnecting leaves them independent", () => {
	const file = createTestCircuit();
	const store = createCircuitStore(file);
	const [first, second] = file.circuit.nets;
	store.execute({ type: "connect", pinIds: [second.pinIds[0]], netId: first.id });
	store.execute({ type: "split-net", netId: first.id, pinIds: second.pinIds });
	const split = store.getSnapshot().circuit.nets.find((net) => net.pinIds.includes(second.pinIds[0]))!;
	assert.notEqual(split.id, first.id);
	assert.deepEqual(split.pinIds, second.pinIds);
	assert.deepEqual(split.names, []);
	store.execute({ type: "disconnect", pinIds: second.pinIds });
	assert.deepEqual(store.getSnapshot().circuit.nets.find((net) => net.id === split.id)?.pinIds, []);
	assert.ok(!store.getSnapshot().circuit.nets.some((net) => net.pinIds.some((id) => second.pinIds.includes(id))));
});

test("invalid commands publish nothing and preserve history", () => {
	const file = createTestCircuit();
	const store = createCircuitStore(file);
	const before = store.getSnapshot();
	let notifications = 0;
	store.subscribe(() => notifications++);
	assert.throws(() => store.execute({ type: "connect", pinIds: ["missing"] }));
	assert.throws(() => store.execute({ type: "rename-net", id: file.circuit.nets[1].id, names: ["3V3"] }));
	assert.throws(() => store.execute({ type: "split-net", netId: file.circuit.nets[0].id, pinIds: file.circuit.nets[0].pinIds }));
	assert.throws(() => store.execute({ type: "update-component", id: file.circuit.components[1].id, reference: "J1", value: "" }));
	assert.throws(() => store.execute({ type: "move", positions: [{ id: "missing", kind: "component", x: 0, y: 0 }] }));
	assert.throws(() => store.execute({ type: "replace", file: createCircuit("Another circuit") }));
	assert.equal(store.getSnapshot(), before);
	assert.equal(notifications, 0);
});

test("standalone nets survive disconnection, component deletion, serialization, and arrangement", () => {
	const store = createCircuitStore(createCircuit("Ground bus"));
	const net = { id: "ground-bus", names: ["GND"], pinIds: [] as string[] };
	store.execute({ type: "add-net", net, position: { x: 650, y: 350 } });
	const empty = store.getSnapshot();
	assert.deepEqual(parseCircuit(serializeCircuit(empty.circuit)), empty.circuit);
	assert.deepEqual(buildCircuitGraph(empty).nets[0].net, net);
	assert.equal(buildCircuitGraph(empty).edges.length, 0);
	assert.doesNotThrow(() => circuitFileSchema.parse({ circuit: empty.circuit, graph: { ...empty.graph, positions: arrangeCircuitGraph(empty) } }));
	const component = createCircuitComponent("resistor", []);
	store.execute({ type: "add-component", component });
	store.execute({ type: "connect", pinIds: [component.pins[0].id], netId: net.id });
	store.execute({ type: "disconnect", pinIds: [component.pins[0].id] });
	assert.deepEqual(store.getSnapshot().circuit.nets, [net]);
	assert.deepEqual(store.getSnapshot().graph, empty.graph);
	store.execute({ type: "connect", pinIds: [component.pins[0].id], netId: net.id });
	store.execute({ type: "remove-component", id: component.id });
	assert.deepEqual(store.getSnapshot().circuit.nets, [net]);
	assert.deepEqual(store.getSnapshot().graph, empty.graph);
});

test("net creation and removal are atomic, undoable, and preserve unrelated memberships", () => {
	const store = createCircuitStore(createTestCircuit());
	const original = store.getSnapshot();
	assert.throws(() => store.execute({ type: "add-net", net: { id: "bad", names: ["GND"], pinIds: [] } }));
	assert.throws(() => store.execute({ type: "add-net", net: { id: "bad", names: [], pinIds: [] }, position: { x: NaN, y: 20 } }));
	assert.equal(store.getSnapshot(), original);
	store.execute({ type: "add-net", net: { id: "bus", names: ["GROUND"], pinIds: [] }, position: { x: 300, y: 200 } });
	const added = store.getSnapshot();
	store.undo();
	assert.deepEqual(store.getSnapshot().circuit, original.circuit);
	assert.deepEqual(store.getSnapshot().graph, original.graph);
	store.redo();
	assert.deepEqual(store.getSnapshot().circuit, added.circuit);
	const removed = added.circuit.nets[0];
	store.execute({ type: "remove-net", id: removed.id });
	assert.deepEqual(store.getSnapshot().circuit.components, added.circuit.components);
	assert.deepEqual(store.getSnapshot().circuit.nets, added.circuit.nets.filter(net => net.id !== removed.id));
	assert.ok(!store.getSnapshot().graph.positions.some(position => position.id === removed.id));
	store.undo();
	assert.deepEqual(store.getSnapshot().circuit, added.circuit);
	assert.deepEqual(store.getSnapshot().graph, added.graph);
});

test("connecting onto an empty named net preserves its name, identity, and layout", () => {
	const store = createCircuitStore(createTestCircuit());
	store.execute({ type: "add-net", net: { id: "bus", names: ["GROUND"], pinIds: [] }, position: { x: 700, y: 100 } });
	const before = store.getSnapshot();
	const source = before.circuit.nets[0];
	store.execute({ type: "connect", pinIds: [source.pinIds[0]], netId: "bus" });
	assert.deepEqual(store.getSnapshot().circuit.nets.find(net => net.id === "bus"), { id: "bus", names: ["GROUND", ...source.names], pinIds: source.pinIds });
	assert.ok(store.getSnapshot().graph.positions.some(position => position.id === "bus" && position.x === 700));
	assert.ok(!store.getSnapshot().circuit.nets.some(net => net.id === source.id));
	store.undo();
	assert.deepEqual(store.getSnapshot().circuit, before.circuit);
	assert.deepEqual(store.getSnapshot().graph, before.graph);
});

test("no-connect declarations and component deletion clean up memberships and layout", () => {
	const file = createTestCircuit();
	const store = createCircuitStore(file);
	const pin = file.circuit.components[0].pins[0];
	store.execute({ type: "no-connect", pinId: pin.id, enabled: true });
	assert.deepEqual(store.getSnapshot().circuit.noConnectPinIds, [pin.id]);
	assert.ok(!store.getSnapshot().circuit.nets.some((net) => net.pinIds.includes(pin.id)));
	store.execute({ type: "connect", pinIds: [pin.id], netId: file.circuit.nets[0].id });
	assert.deepEqual(store.getSnapshot().circuit.noConnectPinIds, []);
	store.execute({ type: "remove-component", id: file.circuit.components[0].id });
	assert.ok(!store.getSnapshot().graph.positions.some((position) => position.id === file.circuit.components[0].id));
	assert.ok(!store.getSnapshot().circuit.nets.some((net) => net.pinIds.includes(pin.id)));
	store.undo();
	assert.equal(store.getSnapshot().circuit.components.length, file.circuit.components.length);
});

test("large nets produce one membership edge per pin and layouts accommodate tall components", () => {
	const file = createCircuit("Large net");
	for (let index = 0; index < 100; index++) file.circuit.components.push(createCircuitComponent("connector-8", file.circuit.components));
	file.circuit.nets.push({ id: "ground", names: ["GND"], pinIds: file.circuit.components.flatMap((component) => component.pins.map((pin) => pin.id)) });
	file.graph.positions = arrangeCircuitGraph(file);
	const graph = buildCircuitGraph(circuitFileSchema.parse(file));
	assert.equal(graph.edges.length, 800);
	assert.ok(graph.components[4].y > graph.components[0].y + graph.components[0].height);
});

test("collapsed components hide every pin and share one endpoint per side without changing electrical identities", () => {
	const file = createCircuit("Large component");
	const component = instantiateCircuitPart({ id: "device", name: "Device", prefix: "U", value: "", pins: Array.from({length:128},(_,index) => ({name:`P${index+1}`,number:String(index+1)})) }, []);
	file.circuit.components.push(component);
	file.circuit.nets.push({ id: "signal", names: ["SIGNAL"], pinIds: [component.pins[0].id, component.pins[99].id] });
	file.circuit.nets.push({ id: "supply", names: ["VCC"], pinIds: [component.pins[50].id] });
	file.graph.positions.push({ id: component.id, kind: "component", x: 60, y: 80 }, { id: "supply", kind: "net", x: -200, y: 80 });
	const store = createCircuitStore(file);
	const expanded = buildCircuitGraph(file);
	store.execute({type:"set-component-collapsed",id:component.id,collapsed:true});
	const snapshot = store.getSnapshot();
	const compact = buildCircuitGraph(snapshot);
	assert.deepEqual(snapshot.circuit,file.circuit);
	assert.deepEqual(snapshot.graph.positions,file.graph.positions);
	assert.deepEqual(snapshot.graph.collapsedComponentIds,[component.id]);
	assert.equal(compact.components[0].height,84);
	assert.ok(compact.components[0].height < expanded.components[0].height / 10);
	assert.equal(compact.components[0].hiddenPinCount,128);
	assert.deepEqual(compact.components[0].visiblePins,[]);
	assert.equal(compact.pinNodes.size,128);
	assert.deepEqual(compact.edges[0].pin,compact.edges[1].pin);
	assert.equal(compact.edges[0].pin.side,"right");
	assert.equal(compact.edges[2].pin.side,"left");
	assert.equal(compact.edges[2].pin.x,60);
	assert.equal(compact.edges[2].pin.y,compact.edges[0].pin.y);
	assert.deepEqual(compact.components[0].connectionSides,["right","left"]);
	assert.equal(new Set(compact.edges.map(edge=>edge.netId)).size,2);
	assert.doesNotThrow(()=>arrangeCircuitGraph(snapshot));
	assert.doesNotThrow(()=>untangleCircuitGraph(snapshot));
	assert.equal(compact.pinNodes.get(component.pins[99].id)?.y,112);
	assert.deepEqual(compact.edges.map(edge=>[edge.pinId,edge.netId]),expanded.edges.map(edge=>[edge.pinId,edge.netId]));
	assert.deepEqual(parseGraphLayout(serializeGraphLayout(snapshot.graph)),snapshot.graph);
	store.undo(); assert.deepEqual(store.getSnapshot().graph,file.graph);
	store.redo(); assert.deepEqual(store.getSnapshot().graph,snapshot.graph);
	store.execute({type:"disconnect",pinIds:[component.pins[0].id]});
	assert.equal(buildCircuitGraph(store.getSnapshot()).components[0].visiblePins.length,0);
	store.execute({type:"connect",pinIds:[component.pins[80].id],netId:"signal"});
	assert.deepEqual(buildCircuitGraph(store.getSnapshot()).components[0].visiblePins,[]);
	store.execute({type:"set-component-collapsed",id:component.id,collapsed:false});
	assert.equal(buildCircuitGraph(store.getSnapshot()).components[0].visiblePins.length,128);
});

test("collapse validation, empty compact components, and deletion preserve graph integrity", () => {
	const file = createCircuit("Compact");
	const component = createCircuitComponent("connector-8", []);
	file.circuit.components.push(component);
	const store = createCircuitStore(file);
	const original = store.getSnapshot();
	assert.throws(()=>store.execute({type:"set-component-collapsed",id:"missing",collapsed:true}));
	assert.equal(store.getSnapshot(),original);
	assert.throws(()=>circuitFileSchema.parse({...file,graph:{...file.graph,collapsedComponentIds:["missing"]}}));
	assert.throws(()=>parseGraphLayout(JSON.stringify({...file.graph,collapsedComponentIds:[component.id,component.id]})));
	store.execute({type:"set-component-collapsed",id:component.id,collapsed:true});
	const graph = buildCircuitGraph(store.getSnapshot());
	assert.equal(graph.components[0].height,84);
	assert.equal(graph.components[0].hiddenPinCount,8);
	assert.equal(graph.pinNodes.size,8);
	assert.doesNotThrow(()=>circuitFileSchema.parse({circuit:store.getSnapshot().circuit,graph:{...store.getSnapshot().graph,positions:arrangeCircuitGraph(store.getSnapshot())}}));
	store.execute({type:"remove-component",id:component.id});
	assert.equal(store.getSnapshot().graph.collapsedComponentIds,undefined);
	store.undo(); assert.deepEqual(store.getSnapshot().graph.collapsedComponentIds,[component.id]);
});

function memoryDirectory() {
	const files = new Map<string, Uint8Array>();
	let failPath = "";
	const directory: ProjectDirectory = {
		name: "Circuit project",
		async read(path) { const bytes = files.get(path); if (!bytes) throw Object.assign(new Error("Missing file"), { code: "ENOENT" }); return bytes; },
		async write(path, bytes) { if (path === failPath) throw new Error("Disk full"); files.set(path, bytes); },
		async remove(path) { for (const key of files.keys()) if (key === path || key.startsWith(`${path}/`)) files.delete(key); },
	};
	return { directory, files, fail(path: string) { failPath = path; } };
}

for (const layout of ["files", "revisions"] as const) {
	test(`only electrical circuit data is persisted with ${layout} storage`, async () => {
		const memory = memoryDirectory();
		const repository = new ProjectRepository(memory.directory, { layout });
		await repository.create("Circuit project");
		const file = createTestCircuit();
		const saved = await repository.save({ shapes: [], symbols: [], circuits: [file] });
		const paths = saved.manifest.circuits![0];
		assert.ok(paths.circuit.endsWith(".ecaddraw"));
		assert.equal(paths.circuit, saved.manifest.drawings![saved.drawings!.findIndex(drawing => drawing.circuitId === file.circuit.id)]);
		assert.ok(![...memory.files.keys()].some(path => path.endsWith(".ecadcircuit")));
		assert.deepEqual(JSON.parse(new TextDecoder().decode(memory.files.get(paths.circuit))).circuit, file.circuit);
		assert.equal(paths.graph, undefined);
		assert.ok(![...memory.files.keys()].some(path=>path.endsWith(".ecadgraph")));
		assert.ok(!new TextDecoder().decode(memory.files.get(paths.circuit)).includes("positions"));
		assert.deepEqual((await new ProjectRepository(memory.directory, { layout }).load()).circuits?.map(file=>file.circuit), saved.circuits!.map(file=>file.circuit));
		const changed = structuredClone(file);
		changed.circuit.components[0].value = "New value";
		changed.graph.positions[0].x += 50;
		memory.fail(".ecadprj");
		await assert.rejects(repository.save({ shapes: [], symbols: [], circuits: [changed] }), /Disk full/);
		assert.deepEqual((await new ProjectRepository(memory.directory, { layout }).load()).circuits?.map(file=>file.circuit), saved.circuits!.map(file=>file.circuit));
		memory.fail("");
		await repository.save({ shapes: [], symbols: [] });
		assert.deepEqual((await new ProjectRepository(memory.directory, { layout }).load()).circuits?.map(file=>file.circuit), saved.circuits!.map(file=>file.circuit));
		await repository.save({ shapes: [], symbols: [], circuits: [] });
		assert.equal((await new ProjectRepository(memory.directory, { layout }).load()).circuits?.length, 1);
		assert.equal((await new ProjectRepository(memory.directory, { layout }).load()).circuits?.[0].circuit.id, "pcb-main");
		assert.ok(!memory.files.has(paths.circuit));
	});
}

test("desktop circuit saves reject external electrical circuit edits", async () => {
 const memory = memoryDirectory();
 const repository = new ProjectRepository(memory.directory, {layout:"files"});
 await repository.create("Circuit project");
 const saved = await repository.save({shapes:[],symbols:[],circuits:[createTestCircuit()]});
 memory.files.set(saved.manifest.circuits![0].circuit,new TextEncoder().encode("{}"));
 await assert.rejects(repository.save({shapes:[],symbols:[]}),/changed on disk/);
});

for (const layout of ["files","revisions"] as const) test(`legacy graph positions are discarded and graph references removed with ${layout} storage`,async()=>{
 const memory=memoryDirectory();
 const repository=new ProjectRepository(memory.directory,{layout});
 await repository.create("Circuit project");
 const file=createTestCircuit();
 await repository.save({shapes:[],symbols:[],circuits:[file]});
 const graphPath="legacy.ecadgraph";
 const legacy={...file.graph,positions:file.graph.positions.map(position=>({...position,x:9999,y:8888})),collapsedComponentIds:[file.circuit.components[0].id]};
 memory.files.set(graphPath,new TextEncoder().encode(serializeGraphLayout(legacy)));
 const manifest=parseProjectManifest(new TextDecoder().decode(memory.files.get(".ecadprj")));
 manifest.circuits![0].graph=graphPath;
 memory.files.set(".ecadprj",new TextEncoder().encode(serializeProjectManifest(manifest)));
 const reopenedRepository=new ProjectRepository(memory.directory,{layout});
 const reopened=await reopenedRepository.load();
 assert.deepEqual(reopened.circuits?.[0].circuit,file.circuit);
 assert.notDeepEqual(reopened.circuits?.[0].graph.positions,legacy.positions);
 assert.equal(reopened.circuits?.[0].graph.collapsedComponentIds,undefined);
 const migrated=await reopenedRepository.save(reopened);
 assert.equal(migrated.manifest.circuits?.[0].graph,undefined);
 if(layout==="files") assert.ok(!memory.files.has(graphPath));
 assert.deepEqual((await new ProjectRepository(memory.directory,{layout}).load()).circuits?.[0].circuit,file.circuit);
});

 test("untangling reduces crossings, separates overlapping nodes, and leaves connectivity intact",()=>{
 const file=createCircuit("Crossings");
 for(let index=0;index<4;index++) file.circuit.components.push(createCircuitComponent("resistor",file.circuit.components));
 const [a,b,c,d]=file.circuit.components;
 file.circuit.nets.push({id:"a",names:["A"],pinIds:[a.pins[0].id,d.pins[0].id]},{id:"b",names:["B"],pinIds:[b.pins[0].id,c.pins[0].id]});
 file.graph.positions=[{id:a.id,kind:"component",x:60,y:60},{id:b.id,kind:"component",x:500,y:60},{id:c.id,kind:"component",x:60,y:400},{id:d.id,kind:"component",x:500,y:400},{id:"a",kind:"net",x:800,y:350},{id:"b",kind:"net",x:-140,y:350}];
 const before=structuredClone(file);
 const quality=circuitLayoutQuality(file);
 assert.ok(quality.crossings>0);
 const positions=untangleCircuitGraph(file);
 const after={...file,graph:{...file.graph,positions}};
 assert.equal(circuitLayoutQuality(after).overlaps,0);
 assert.ok(circuitLayoutQuality(after).crossings<quality.crossings);
 assert.deepEqual(file,before);
 assert.deepEqual(untangleCircuitGraph(file),positions);
 assert.deepEqual(new Set(positions.map(position=>position.id)),new Set(file.graph.positions.map(position=>position.id)));
 assert.ok(positions.every(position=>position.x%20===0 && position.y%20===0));
 const pile={...file,graph:{...file.graph,positions:file.graph.positions.map(position=>({...position,x:0,y:0}))}};
 assert.equal(circuitLayoutQuality({...pile,graph:{...pile.graph,positions:untangleCircuitGraph(pile)}}).overlaps,0);
 assert.deepEqual(createCircuitView(file.circuit),createCircuitView(file.circuit));
 assert.deepEqual(untangleCircuitGraph(createCircuit("Empty")),[]);
 const leds=createTestCircuit();
 const ledLayout={...leds,graph:{...leds.graph,positions:untangleCircuitGraph(leds)}};
 assert.equal(circuitLayoutQuality(ledLayout).overlaps,0);
 assert.equal(circuitLayoutQuality(ledLayout).obstructions,0);
 assert.equal(circuitLayoutQuality(ledLayout).crossings,0);
});

for(const layout of ["files","revisions"] as const) test(`legacy PCB identities and names receive valid paired drawing files with ${layout} storage`,async()=>{
 const memory=memoryDirectory();const repository=new ProjectRepository(memory.directory,{layout});
 await repository.create("Legacy");
 const files=[createCircuit("Board","Board_1"),createCircuit("Power / analog","board-1"),createCircuit("CON","board_1")];
 const saved=await repository.save({shapes:[],symbols:[],circuits:files});
 assert.deepEqual(saved.circuits!.slice(0,3).map(file=>[file.circuit.id,file.circuit.name]),files.map(file=>[file.circuit.id,file.circuit.name]));
 const drawings=saved.drawings!;
 assert.equal(new Set(drawings.map(drawing=>drawing.id)).size,3);
 assert.ok(drawings.every(drawing=>/^[a-z0-9][a-z0-9_-]*$/.test(drawing.id)));
 const reopened=await new ProjectRepository(memory.directory,{layout}).load();
 assert.deepEqual(reopened.circuits!.map(file=>file.circuit),saved.circuits!.map(file=>file.circuit));
});

for (const layout of ["files", "revisions"] as const) {
 test(`separate legacy circuits migrate into schematics after a successful ${layout} save`, async () => {
  const memory = memoryDirectory();
  const initial = new ProjectRepository(memory.directory, { layout });
  await initial.create("Legacy");
  const file = createTestCircuit();
  const saved = await initial.save({ shapes: [], symbols: [], circuits: [file] });
  const schematicPath = saved.manifest.circuits![0].circuit;
  const decoder = new TextDecoder(), encoder = new TextEncoder();
  const schematic = JSON.parse(decoder.decode(memory.files.get(schematicPath)));
  delete schematic.circuit;
  memory.files.set(schematicPath, encoder.encode(JSON.stringify(schematic)));
  memory.files.set("legacy.ecadcircuit", encoder.encode(JSON.stringify(file.circuit)));
  const manifest = parseProjectManifest(decoder.decode(memory.files.get(".ecadprj")));
  manifest.circuits![0].circuit = "legacy.ecadcircuit";
  memory.files.set(".ecadprj", encoder.encode(serializeProjectManifest(manifest)));
  const repository = new ProjectRepository(memory.directory, { layout });
  const reopened = await repository.load();
  assert.deepEqual(reopened.circuits![0].circuit, file.circuit);
  memory.fail(".ecadprj");
  await assert.rejects(repository.save(reopened), /Disk full/);
  assert.ok(memory.files.has("legacy.ecadcircuit"));
  assert.equal(JSON.parse(decoder.decode(memory.files.get(schematicPath))).circuit, undefined);
  memory.fail("");
  const migrated = await repository.save(reopened);
  const path = migrated.manifest.circuits![0].circuit;
  assert.ok(path.endsWith(".ecaddraw"));
  assert.deepEqual(JSON.parse(decoder.decode(memory.files.get(path))).circuit, file.circuit);
  assert.deepEqual((await new ProjectRepository(memory.directory, { layout }).load()).circuits![0].circuit, file.circuit);
  if (layout === "files") assert.ok(!memory.files.has("legacy.ecadcircuit"));
 });
}
