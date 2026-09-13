import assert from 'node:assert/strict'
import test from 'node:test'
import { screenToWorld } from '../src/engine/camera'
import { gestureCamera, panCamera } from '../src/engine/navigation'
import type { Point } from '../src/engine/types'

function samePoint(actual: Point, expected: Point) {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9)
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9)
}
const camera = { x: 12, y: -3, scale: 8 }
const width = 900, height = 600

test('dragging follows the pointer in screen pixels at any scale', () => {
  for (const scale of [0.01, 8, 10000]) {
    const start = { ...camera, scale }
    const next = panCamera(start, { x: 30, y: -70 })
    samePoint(screenToWorld({ x: 130, y: 130 }, next, width, height), screenToWorld({ x: 100, y: 200 }, start, width, height))
    assert.equal(next.scale, scale)
  }
})

test('zoom keeps an off-centre cursor over the same world coordinate', () => {
  const anchor = { x: 170, y: 480 }
  for (const factor of [0.5, 2, 1e10, 1e-10]) {
    const next = gestureCamera(camera, anchor, anchor, factor, width, height, camera.scale)
    samePoint(screenToWorld(anchor, next, width, height), screenToWorld(anchor, camera, width, height))
    assert.ok(next.scale >= camera.scale * 0.25 && next.scale <= camera.scale * 8)
  }
})

test('pinch translates the midpoint and scales simultaneously, then one-finger drag continues smoothly', () => {
  const from = { x: 300, y: 200 }, to = { x: 360, y: 250 }
  const next = gestureCamera(camera, from, to, 1.8, width, height, camera.scale)
  assert.equal(next.scale, camera.scale * 1.8)
  const anchor = screenToWorld(from, camera, width, height)
  samePoint(screenToWorld(to, next, width, height), anchor)
  const dragged = panCamera(next, { x: 10, y: 20 })
  samePoint(screenToWorld({ x: to.x + 10, y: to.y + 20 }, dragged, width, height), anchor)
})

test('zoom in and out round trips and invalid factors cannot corrupt the camera', () => {
  const anchor = { x: 810, y: 50 }
  const zoomed = gestureCamera(camera, anchor, anchor, 1.25, width, height, camera.scale)
  const restored = gestureCamera(zoomed, anchor, anchor, 1 / 1.25, width, height, camera.scale)
  samePoint(restored, camera)
  assert.equal(restored.scale, camera.scale)
  for (const factor of [NaN, Infinity, -1, 0]) assert.deepEqual(gestureCamera(camera, anchor, anchor, factor, width, height, camera.scale), camera)
})

test('zoom is limited to 25–800% of the initial fitted scale', () => {
  const anchor = { x: 100, y: 100 }
  for (const baseScale of [0.1, 8, 500]) {
    const start = { ...camera, scale: baseScale }
    assert.equal(gestureCamera(start, anchor, anchor, 1e-10, width, height, baseScale).scale, baseScale * 0.25)
    assert.equal(gestureCamera(start, anchor, anchor, 1e10, width, height, baseScale).scale, baseScale * 8)
  }
})
