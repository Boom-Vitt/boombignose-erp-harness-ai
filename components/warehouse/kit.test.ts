import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { angDiff, expand, polar, sampleWalk, walk } from "./kit"

describe("campus paths", () => {
  it("angDiff takes the short way round", () => {
    expect(angDiff(0.1, -0.1)).toBeCloseTo(-0.2)
    expect(angDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2)
  })

  it("expand follows the circle on equal-radius legs and stays on the ring", () => {
    const pts = expand([[20, 0], [20, Math.PI / 2]], 3)
    expect(pts.length).toBeGreaterThan(10)
    for (const p of pts) expect(Math.hypot(p.x, p.z)).toBeCloseTo(20)
    expect(pts[pts.length - 1].distanceTo(polar(20, Math.PI / 2, 3))).toBeLessThan(1e-6)
  })

  it("walk samples by distance and clamps at both ends", () => {
    const w = walk([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 0, 10)])
    const out = new THREE.Vector3()
    expect(w.len).toBeCloseTo(20)
    expect(sampleWalk(w, 15, out).toArray()).toEqual([10, 0, 5])
    expect(sampleWalk(w, 999, out).toArray()).toEqual([10, 0, 10])
    expect(sampleWalk(w, -5, out).toArray()).toEqual([0, 0, 0])
  })
})
