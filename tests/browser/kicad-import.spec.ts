import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EditorShape, EditorSymbol } from '#/drawing/shapes.ts';
import { importKiCadSchematic } from '#/formats/kicad/import.ts';
import { openProjectFiles } from './project-files';

const fixture = resolve('tests/fixtures/kicad/RPI-RP2350A-MINIMAL_R4-S1.kicad_sch');
const canonical = (value: unknown) => JSON.parse(JSON.stringify(value,(_key,entry)=>typeof entry==='number'?Number(entry.toFixed(9)):entry));
const expected = importKiCadSchematic(readFileSync(fixture,'utf8'));

test('imported RP2350A drawing reopens with its components, terminals, wires and labels intact', async ({page}) => {
 await page.goto('/tests/browser/projects.html');
 await page.getByLabel('Project name',{exact:true}).fill('KiCad reload');
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await (await openProjectFiles(page)).getByLabel('Add KiCad schematic files').setInputFiles(fixture);
 await expect(page.getByRole('button',{name:'Download import report',exact:true})).toBeVisible();
 const download = page.waitForEvent('download');
 await page.getByRole('button',{name:'Download import report',exact:true}).click();
 const file = await download;
 const path = await file.path();
 expect(path).not.toBeNull();
 const report = JSON.parse(readFileSync(path!,'utf8'));
 expect(report.components).toEqual(expected.report.components);
 expect(report.metadata).toEqual(expected.report.metadata);
 await expect.poll(async()=>canonical(JSON.parse(await page.locator('#project-document').textContent()??'{}').editorShapes)).toEqual(canonical(expected.shapes));
 await page.reload();
 const link=(await openProjectFiles(page)).getByRole('link',{name:'Open kicad-import.ecaddraw',exact:true});
 await link.click();
 await expect(page.getByRole('heading',{name:/Schematic editor .* RPI-RP2350A-MINIMAL_R4-S1/})).toBeVisible();
 await expect.poll(async()=>{
  const document = JSON.parse(await page.locator('#project-document').textContent()??'{}');
  return canonical(document.editorShapes as EditorShape[]);
 }).toEqual(canonical(expected.shapes));
 await page.keyboard.press('F6');
 await page.screenshot({path:resolve('perf-artifacts/kicad-reopened-schematic.png')});
});

test('all native pin-name and pin-number visibility combinations survive import and reopen', async ({page}) => {
 const {pinVisibilitySource,visibilityCases} = await import('../fixtures/kicad/pin-visibility');
 const imported=importKiCadSchematic(pinVisibilitySource).shapes;
 await page.goto('/tests/browser/projects.html');
 await page.getByLabel('Project name',{exact:true}).fill('KiCad native pins');
 await page.getByRole('button',{name:'Create project',exact:true}).click();
 await (await openProjectFiles(page)).getByLabel('Add KiCad schematic files').setInputFiles({name:'visibility.kicad_sch',mimeType:'text/plain',buffer:Buffer.from(pinVisibilitySource)});
 await expect(page.getByRole('heading',{name:/Schematic editor .* visibility/})).toBeVisible();
 await page.getByRole('button',{name:'Dismiss import report',exact:true}).click();
 await page.keyboard.press('F6');
 const labels = () => page.evaluate(()=>JSON.parse(document.documentElement.dataset.pinLabels??'[]').map((name:string)=>name.replace(/^pin (name|number) .*/,'$1')).sort());
 await expect.poll(labels).toEqual(['name','name','number','number']);
 await page.reload();
 await (await openProjectFiles(page)).getByRole('link',{name:'Open kicad-import.ecaddraw',exact:true}).click();
 await expect(page.getByRole('heading',{name:/Schematic editor .* visibility/})).toBeVisible();
 await expect.poll(async()=>canonical(JSON.parse(await page.locator('#project-document').textContent()??'{}').editorShapes)).toEqual(canonical(imported));
 const data=JSON.parse(await page.locator('#project-document').textContent()??'{}');
 expect((data.editorShapes as EditorSymbol[]).flatMap(symbol=>symbol.children.filter(child=>child.kind==='pin').map(pin=>({showName:pin.showName,showNumber:pin.showNumber})))).toEqual(visibilityCases);
 await page.keyboard.press('F6');
 await expect.poll(labels).toEqual(['name','name','number','number']);
 await page.screenshot({path:resolve('perf-artifacts/kicad-native-pin-visibility.png')});
});
