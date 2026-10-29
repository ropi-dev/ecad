import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit, parseCircuit, serializeCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { createCircuitStore } from "@ecad/drawing-core/circuit/store.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { parseSymbolFile } from "#/components/editor/symbolFormat.ts";
import { symbolDefinitions } from "#/drawing/symbols.ts";
import { resolveSymbolLibraries, type ConfiguredSymbolLibrary } from "#/symbol-library/config.ts";

test("symbol placement snapshots library identity and all pins with independent instance identities", () => {
	const definition = symbolDefinitions.find(definition => definition.id === "rp2040")!;
	const first = componentFromSymbol(definition, []);
	const second = componentFromSymbol(definition, [first]);
	const sourcePins = definition.children.filter(child => child.kind === "pin");
	assert.equal(first.reference, "U1");
	assert.equal(second.reference, "U2");
	assert.deepEqual(first.part, { id: definition.id, name: definition.name, library: definition.library });
	assert.equal(first.pins.length, 57);
	assert.deepEqual(first.pins.map(pin => [pin.number, pin.name, pin.sourcePinId]), sourcePins.map(pin => [pin.number, pin.name, String(pin.id)]));
	assert.equal(new Set([first.id, second.id, ...first.pins.map(pin => pin.id), ...second.pins.map(pin => pin.id)]).size, 116);
	const circuit = createCircuit("Snapshot").circuit;
	circuit.components.push(first, second);
	assert.deepEqual(parseCircuit(serializeCircuit(circuit)), circuit);
	assert.ok(!serializeCircuit(circuit).includes('"children"'));
});

test("unnumbered legacy pins receive numbers and source definitions remain independent", () => {
	const definition = structuredClone(symbolDefinitions.find(definition => definition.id === "resistor")!);
	const component = componentFromSymbol(definition, [{...componentFromSymbol(definition, []), reference:"R1"}]);
	assert.equal(component.reference, "R2");
	assert.deepEqual(component.pins.map(pin => pin.number), ["1", "2"]);
	const original = structuredClone(component);
	const pin = definition.children.find(child => child.kind === "pin")!;
	pin.name = "Changed";
	pin.number = "99";
	definition.library!.id = "Changed";
	assert.deepEqual(component, original);
});

test("nested project symbols use the same resolved pins and project precedence as schematic symbols", async () => {
	const child = parseSymbolFile(JSON.stringify({format:"ecad-symbol",version:1,units:"mm",id:"child",name:"Child",description:"",prefix:"J",value:"",shapes:[{kind:"pin",number:"A1",name:"Signal",x:0,y:0}]}));
	const parent = parseSymbolFile(JSON.stringify({format:"ecad-symbol",version:1,units:"mm",id:"parent",name:"Parent",description:"",prefix:"U",value:"Part",shapes:[{kind:"symbol",library:{scope:"project",id:"parts"},definitionId:"child",x:0,y:0}]}));
	const library: ConfiguredSymbolLibrary = {id:"parts",name:"Parts",enabled:true,source:{kind:"embedded",symbols:[child,parent]}};
	const resolved = await resolveSymbolLibraries([{...library,source:{kind:"embedded",symbols:[{...parent,name:"User parent",shapes:child.shapes}]}}], [library]);
	assert.deepEqual(resolved.errors, []);
	const definition = resolved.definitions.find(definition => definition.id === parent.id)!;
	const component = componentFromSymbol(definition, []);
	assert.deepEqual(component.part.library, {scope:"project",id:"parts"});
	assert.equal(component.part.name, "Parent");
	assert.deepEqual(component.pins.map(pin => [pin.number,pin.name]), [["A1","Signal"]]);
});

test("a placed symbol and its layout form one undo transaction and invalid placements publish nothing", () => {
	const store = createCircuitStore(createCircuit("Placement"));
	const original = store.getSnapshot();
	const component = componentFromSymbol(symbolDefinitions.find(definition => definition.id === "resistor")!, []);
	assert.throws(() => store.execute({type:"add-component",component,position:{x:NaN,y:10}}));
	assert.equal(store.getSnapshot(), original);
	store.execute({type:"add-component",component,position:{x:120,y:240}});
	assert.deepEqual(store.getSnapshot().graph.positions, [{id:component.id,kind:"component",x:120,y:240}]);
	store.undo();
	assert.deepEqual(store.getSnapshot().circuit, original.circuit);
	assert.deepEqual(store.getSnapshot().graph, original.graph);
	assert.equal(store.getSnapshot().canUndo,false);
	store.redo();
	assert.deepEqual(store.getSnapshot().circuit.components, [component]);
	assert.throws(() => componentFromSymbol(symbolDefinitions.find(definition => definition.id === "box")!, []));
});
