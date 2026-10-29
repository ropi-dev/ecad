import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuit, circuitFileSchema } from "@ecad/drawing-core/circuit/model.ts";
import { applyCircuitCommand } from "@ecad/drawing-core/circuit/store.ts";
import { synchronizePcb } from "#/circuit/linked-schematic.ts";
import { componentFromSymbol } from "#/circuit/symbol-components.ts";
import { createSymbol, symbolDefinitions } from "#/drawing/symbols.ts";
import { pairPcbDocuments } from "#/projects/pcb.ts";

const resistor = symbolDefinitions.find(definition => definition.id === "resistor")!;
test("schematic instances keep component and pin identities through edits and duplication", () => {
 const original = createCircuit("Board");
 const symbol = createSymbol(1, resistor, {x:0,y:0}, "R1");
 const first = synchronizePcb(original, [symbol], original, symbolDefinitions);
 const second = synchronizePcb(first.file, [{...symbol, x:50, attributes:{...symbol.attributes,value:"10k"}},createSymbol(2,resistor,{x:100,y:0},"R2")],first.file,symbolDefinitions);
 assert.equal(second.file.circuit.components.length,2);
 assert.equal(second.file.circuit.components[0].id,first.file.circuit.components[0].id);
 assert.deepEqual(second.file.circuit.components[0].pins,first.file.circuit.components[0].pins);
 assert.equal(second.file.circuit.components[0].value,"10k");
 circuitFileSchema.parse(second.file);
});
test("circuit placements, connections, renames and deletion reach the schematic and round trip", () => {
 let file = createCircuit("Board");
 const a=componentFromSymbol(resistor,[]), b=componentFromSymbol(resistor,[a]);
 file=applyCircuitCommand(file,{type:"add-component",component:a});
 file=applyCircuitCommand(file,{type:"add-component",component:b});
 const first=synchronizePcb(file,[],createCircuit("Board",file.circuit.id),symbolDefinitions);
 assert.equal(first.shapes.filter(shape=>shape.kind==="symbol").length,2);
 const connected=applyCircuitCommand(first.file,{type:"connect",pinIds:[a.pins[0].id,b.pins[0].id]});
 const second=synchronizePcb(connected,first.shapes,first.file,symbolDefinitions);
 assert.equal(second.shapes.filter(shape=>shape.kind==="text").length,2);
 const roundtrip=synchronizePcb(second.file,second.shapes,second.file,symbolDefinitions);
 assert.deepEqual(roundtrip.file.circuit.nets,second.file.circuit.nets);
 const renamed=applyCircuitCommand(second.file,{type:"update-component",id:a.id,reference:"R9",value:"4k7"});
 const third=synchronizePcb(renamed,second.shapes,second.file,symbolDefinitions);
 assert.ok(third.shapes.some(shape=>shape.kind==="symbol"&&shape.attributes.reference==="R9"));
 const removed=applyCircuitCommand(third.file,{type:"remove-component",id:a.id});
 const fourth=synchronizePcb(removed,third.shapes,third.file,symbolDefinitions);
 assert.equal(fourth.shapes.filter(shape=>shape.kind==="symbol").length,1);
 circuitFileSchema.parse(fourth.file);
});
test("PCB pairing is stable and leaves inputs untouched",()=>{
 const input={shapes:[],symbols:[],drawings:[{id:"board",name:"Board",shapes:[]}]};
 const paired=pairPcbDocuments(input,"Project");
 assert.equal(paired.circuits?.length,2);
 assert.deepEqual(pairPcbDocuments(paired,"Project"),paired);
 assert.equal("circuitId" in input.drawings[0],false);
});

test("legacy circuit pins and connections survive repeated synchronization", async () => {
 const { createTestCircuit } = await import("./fixtures/circuit.ts");
 const original = createTestCircuit();
 const first = synchronizePcb(original, [], original, symbolDefinitions);
 assert.ok(first.shapes.some(shape=>shape.kind==="text"&&shape.electrical));
 const { drawingFileSchema } = await import("#/projects/format.ts");
 drawingFileSchema.parse({id:"board",name:"Board",shapes:first.shapes});
 const next = synchronizePcb(first.file, first.shapes, first.file, symbolDefinitions);
 assert.deepEqual(next.file.circuit.nets, first.file.circuit.nets);
 const stable = synchronizePcb(next.file, next.shapes, next.file, symbolDefinitions);
 assert.deepEqual(stable.file.circuit, next.file.circuit);
});

test("standalone named and unnamed nets retain their identities",()=>{
 const original=createCircuit("Board");
 const file=structuredClone(original);
 file.circuit.nets=[{id:"ground",names:["GND"],pinIds:[]},{id:"spare",names:[],pinIds:[]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const next=synchronizePcb(first.file,first.shapes,first.file,symbolDefinitions);
 assert.deepEqual(next.file.circuit.nets,file.circuit.nets);
});

test("placing a circuit component keeps existing schematic wire geometry", async()=>{
 const { drawShape }=await import("#/drawing/shapes.ts");
 const original=createCircuit("Board");
 const wire=drawShape(3,"wire",{x:3,y:0},{x:7,y:0});
 const first=synchronizePcb(original,[createSymbol(1,resistor,{x:0,y:0},"R1"),createSymbol(2,resistor,{x:10,y:0},"R2"),wire],original,symbolDefinitions);
 const added=applyCircuitCommand(first.file,{type:"add-component",component:componentFromSymbol(resistor,first.file.circuit.components)});
 const next=synchronizePcb(added,first.shapes,first.file,symbolDefinitions);
 assert.deepEqual(next.shapes.find(shape=>shape.id===3),wire);
});

test("automatic labels use readable circuit names, natural sizing and outward alignment", () => {
 const original=createCircuit("Labels");
 const file=structuredClone(original);
 const left=componentFromSymbol(resistor,[]), right=componentFromSymbol(resistor,[left]);
 file.circuit.components=[left,right];
 file.circuit.nets=[{id:crypto.randomUUID(),names:[],pinIds:[left.pins[1].id,right.pins[0].id]}];
 const linked=synchronizePcb(file,[],original,symbolDefinitions);
 const labels=linked.shapes.filter(shape=>shape.kind==="text");
 assert.equal(labels.length,2);
 assert.ok(labels.every(label=>label.text==="R1.2 / R2.1" && label.fontSize===1.3 && label.width>7));
 assert.equal(labels[0].horizontalAlign,"left");
 assert.equal(labels[1].horizontalAlign,"right");
 assert.ok(labels.every(label=>label.verticalAlign==="bottom"));
 const roundtrip=synchronizePcb(linked.file,linked.shapes,linked.file,symbolDefinitions);
 assert.deepEqual(roundtrip.file.circuit.nets,file.circuit.nets);
});

test("old UUID labels and fixed-size named labels migrate without renaming electrical nets", () => {
 const original=createCircuit("Migration");
 const file=structuredClone(original);
 file.circuit.components=[componentFromSymbol(resistor,[])];
 file.circuit.nets=[{id:crypto.randomUUID(),names:[],pinIds:[file.circuit.components[0].pins[0].id]},{id:"supply",names:["LONG_SUPPLY_NAME"],pinIds:[file.circuit.components[0].pins[1].id]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const old=first.shapes.map(shape=>shape.kind==="text"?{...shape,circuitNet:undefined,text:shape.text==="R1.1"?`N_${file.circuit.nets[0].id}`:shape.text,fontSize:1,width:5,height:2,horizontalAlign:undefined,verticalAlign:undefined}:shape);
 const migrated=synchronizePcb(first.file,old,first.file,symbolDefinitions);
 assert.deepEqual(migrated.file.circuit.nets,file.circuit.nets);
 const labels=migrated.shapes.filter(shape=>shape.kind==="text");
 assert.deepEqual(labels.map(label=>label.text),["R1.1","LONG_SUPPLY_NAME"]);
 assert.ok(labels[1].width>10);
 assert.equal(labels[0].horizontalAlign,"right");
 assert.equal(labels[1].horizontalAlign,"left");
 const stable=synchronizePcb(migrated.file,migrated.shapes,migrated.file,symbolDefinitions);
 assert.deepEqual(stable.shapes,migrated.shapes);
 assert.deepEqual(stable.file.circuit,migrated.file.circuit);
});

test("schematic reference edits refresh automatic labels without turning them into explicit net names", () => {
 const original=createCircuit("References");
 const file=structuredClone(original);
 const component=componentFromSymbol(resistor,[]);
 file.circuit.components=[component];
 file.circuit.nets=[{id:"signal",names:[],pinIds:[component.pins[0].id]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const edited=first.shapes.map(shape=>shape.kind==="symbol"?{...shape,attributes:{...shape.attributes,reference:"R9"}}:shape);
 const next=synchronizePcb(first.file,edited,first.file,symbolDefinitions);
 assert.equal(next.shapes.find(shape=>shape.kind==="text")?.text,"R9.1");
 assert.deepEqual(next.file.circuit.nets,file.circuit.nets);
 const stable=synchronizePcb(next.file,next.shapes,next.file,symbolDefinitions);
 assert.deepEqual(stable.file.circuit.nets,file.circuit.nets);
});

test("schematic deletions preserve an anonymous net identity and remove stale membership",()=>{
 const original=createCircuit("Deletion");const file=structuredClone(original);
 const a=componentFromSymbol(resistor,[]),b=componentFromSymbol(resistor,[a]);
 file.circuit.components=[a,b];file.circuit.nets=[{id:"signal",names:[],pinIds:[a.pins[0].id,b.pins[0].id]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const removed=first.shapes.filter(shape=>shape.id!==first.file.circuit.components[0].schematicShapeId);
 const next=synchronizePcb(first.file,removed,first.file,symbolDefinitions);
 assert.deepEqual(next.file.circuit.nets,[{id:"signal",names:[],pinIds:[b.pins[0].id]}]);
 assert.ok(next.shapes.filter(shape=>shape.kind==="text").every(shape=>shape.text==="R2.1"));
});

test("generated caption provenance survives edits made while a rename save is pending",()=>{
 const original=createCircuit("Race");const file=structuredClone(original);
 const a=componentFromSymbol(resistor,[]),b=componentFromSymbol(resistor,[a]);
 file.circuit.components=[a,b];file.circuit.nets=[{id:"signal",names:[],pinIds:[a.pins[0].id,b.pins[0].id]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const renamed=first.shapes.map(shape=>shape.kind==="symbol"&&shape.attributes.reference==="R1"?{...shape,attributes:{...shape.attributes,reference:"R9"}}:shape);
 const saved=synchronizePcb(first.file,renamed,first.file,symbolDefinitions);
 const pending=renamed.map(shape=>shape.kind==="symbol"&&shape.attributes.reference==="R9"?{...shape,attributes:{...shape.attributes,value:"22k"}}:shape);
 const next=synchronizePcb(saved.file,pending,saved.file,symbolDefinitions);
 assert.deepEqual(next.file.circuit.nets,file.circuit.nets);
 assert.equal(next.file.circuit.components[0].value,"22k");
 assert.ok(next.shapes.filter(shape=>shape.kind==="text").every(shape=>shape.text==="R2.1 / R9.1"));
});

test("explicit edits to generated captions become net names",()=>{
 const original=createCircuit("Named");const file=structuredClone(original);
 file.circuit.components=[componentFromSymbol(resistor,[])];file.circuit.nets=[{id:"signal",names:[],pinIds:[file.circuit.components[0].pins[0].id]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const edited=first.shapes.map(shape=>shape.kind==="text"?{...shape,text:"SENSE"}:shape);
 const next=synchronizePcb(first.file,edited,first.file,symbolDefinitions);
 assert.deepEqual(next.file.circuit.nets[0].names,["SENSE"]);
});

test("external circuit synchronization invalidates old undo and redo without losing new components",async()=>{
 const {createCircuitStore}=await import("@ecad/drawing-core/circuit/store.ts");
 const file=createCircuit("History");const a=componentFromSymbol(resistor,[]);file.circuit.components=[a];
 const store=createCircuitStore(file);
 store.execute({type:"update-component",id:a.id,reference:"R9",value:"22k"});
 const external=structuredClone(store.getSnapshot());external.circuit.components.push(componentFromSymbol(resistor,external.circuit.components));
 store.synchronize({circuit:external.circuit,graph:external.graph});store.undo();store.redo();
 assert.equal(store.getSnapshot().circuit.components.length,2);
 assert.equal(store.getSnapshot().canUndo,false);assert.equal(store.getSnapshot().canRedo,false);
 store.execute({type:"update-component",id:a.id,reference:"R8",value:"22k"});
 store.synchronize({circuit:store.getSnapshot().circuit,graph:store.getSnapshot().graph},{preserveHistory:true});
 store.undo();assert.equal(store.getSnapshot().circuit.components[0].reference,"R9");
});

test("legacy LED pins keep their anode and cathode meaning through both projections",async()=>{
 const {createTestCircuit}=await import("./fixtures/circuit.ts");
 const original=createTestCircuit();const first=synchronizePcb(original,[],original,symbolDefinitions);
 const next=synchronizePcb(first.file,first.shapes,first.file,symbolDefinitions);
 for(const old of original.circuit.components){
  const component=next.file.circuit.components.find(component=>component.id===old.id)!;
  assert.deepEqual(component.pins.map(({sourcePinId:_source,...pin})=>pin),old.pins);
 }
 const led=first.file.circuit.components.find(component=>component.part.id==="led")!;
 const symbol=first.shapes.find(shape=>shape.id===led.schematicShapeId)!;
 assert.equal(symbol.kind,"symbol");
 if(symbol.kind!=="symbol")return;
 const anode=symbol.children.find(child=>child.kind==="pin"&&String(child.id)===led.pins.find(pin=>pin.number==="A")!.sourcePinId);
 assert.ok(anode?.kind==="pin");if(anode?.kind==="pin")assert.equal(anode.name,"A");
});

test("standalone net renames reuse their bound caption exactly once",()=>{
 const original=createCircuit("Standalone");const file=structuredClone(original);file.circuit.nets=[{id:"spare",names:[],pinIds:[]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const renamed=applyCircuitCommand(first.file,{type:"rename-net",id:"spare",names:["GND"]});
 const next=synchronizePcb(renamed,first.shapes,first.file,symbolDefinitions);
 assert.equal(next.shapes.length,1);assert.equal(next.shapes[0].kind,"text");
 const stable=synchronizePcb(next.file,next.shapes,next.file,symbolDefinitions);assert.equal(stable.shapes.length,1);
});

test("deleting and undoing the last connected component removes the empty-net fallback caption",()=>{
 const original=createCircuit("Undo");const file=structuredClone(original);
 const a=componentFromSymbol(resistor,[]),b=componentFromSymbol(resistor,[a]);file.circuit.components=[a,b];file.circuit.nets=[{id:"signal",names:[],pinIds:[a.pins[1].id,b.pins[0].id]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const disconnected=applyCircuitCommand(first.file,{type:"disconnect",pinIds:[b.pins[0].id]});
 const second=synchronizePcb(disconnected,first.shapes,first.file,symbolDefinitions);
 const removed=applyCircuitCommand(second.file,{type:"remove-component",id:a.id});
 const third=synchronizePcb(removed,second.shapes,second.file,symbolDefinitions);
 const restored=synchronizePcb(second.file,third.shapes,third.file,symbolDefinitions);
 const labels=restored.shapes.filter(shape=>shape.kind==="text");
 assert.equal(labels.length,1);assert.equal(labels[0].circuitNet?.pinId,a.pins[1].id);
 assert.equal(labels[0].text,"R1.2");
});

for(const electrical of [undefined,"supply"] as const)test(`converting a generated caption to ${electrical??"ordinary text"} preserves the annotation`,()=>{
 const original=createCircuit("Role");const file=structuredClone(original);file.circuit.nets=[{id:"spare",names:[],pinIds:[]}];
 const first=synchronizePcb(file,[],original,symbolDefinitions);
 const edited=first.shapes.map(shape=>shape.kind==="text"?{...shape,electrical}:shape);
 const next=synchronizePcb(first.file,edited,first.file,symbolDefinitions);
 assert.equal(next.shapes.length,1);assert.equal(next.shapes[0].kind,"text");
 if(next.shapes[0].kind!=="text")return;
 assert.equal(next.shapes[0].circuitNet,undefined);assert.equal(next.shapes[0].text,"Net 1");assert.equal(next.shapes[0].electrical,electrical);
 assert.deepEqual(next.file.circuit.nets.map(net=>net.names),electrical==="supply"?[["Net 1"]]:[]);
});

test("blank schematic display names still produce valid circuit parts",()=>{
 const original=createCircuit("Imported");const symbol=createSymbol(1,resistor,{x:0,y:0},"R1");symbol.attributes.name="";
 const linked=synchronizePcb(original,[symbol],original,symbolDefinitions);
 assert.equal(linked.file.circuit.components[0].part.name,"Resistor");
 assert.equal(linked.shapes[0].kind,"symbol");if(linked.shapes[0].kind==="symbol")assert.equal(linked.shapes[0].attributes.name,"");
});

test("repeated PCB names allocate distinct file names without changing existing documents",async()=>{
 const {uniquePcbName}=await import("#/projects/pcb.ts");
 const document={shapes:[],symbols:[],circuits:[createCircuit("Untitled"),createCircuit("Power stage"),createCircuit("Power stage 2")]};
 assert.equal(uniquePcbName("Power stage",document,"Untitled"),"Power stage 3");
 assert.equal(uniquePcbName("Untitled",document,"Untitled"),"Untitled 2");
 assert.deepEqual(document.circuits.map(file=>file.circuit.name),["Untitled","Power stage","Power stage 2"]);
});
