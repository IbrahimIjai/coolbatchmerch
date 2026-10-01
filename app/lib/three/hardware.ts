import * as THREE from 'three'

/** Radius of the clothing rail; hooks are sized to wrap it. */
export const ROD_RADIUS = 0.022

let materials: { wood: THREE.MeshPhysicalMaterial, chrome: THREE.MeshStandardMaterial, brushed: THREE.MeshStandardMaterial } | null = null

export function getHardwareMaterials() {
  materials ??= {
    wood: new THREE.MeshPhysicalMaterial({ color: '#4a1d12', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#f2f2f2', metalness: 1, roughness: 0.14 }),
    brushed: new THREE.MeshStandardMaterial({ color: '#d9d9d9', metalness: 1, roughness: 0.32 })
  }
  return materials
}

const geometryCache = new Map<string, THREE.BufferGeometry>()

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geometryCache.get(key) as T | undefined
  if (!g) {
    g = make()
    geometryCache.set(key, g)
  }
  return g
}

/** Chrome hook that loops over the rail in the hanger's own plane. */
function hookGeometry(baseY: number) {
  return cached(`hook:${baseY}`, () => {
    const r = ROD_RADIUS + 0.009
    const pts = [
      new THREE.Vector3(0, baseY, 0),
      new THREE.Vector3(0, baseY + 0.04, 0),
      new THREE.Vector3(0.006, -0.07, 0),
      new THREE.Vector3(0.021, -0.04, 0)
    ]
    for (let a = -25; a <= 205; a += 15) {
      const rad = THREE.MathUtils.degToRad(a)
      pts.push(new THREE.Vector3(Math.cos(rad) * r, Math.sin(rad) * r, 0))
    }
    pts.push(new THREE.Vector3(-r * 0.82, -0.026, 0))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 96, 0.0062, 10, false)
  })
}

/** Height of the hanger's top edge at x, in hanger space (garments rest on it). */
export function hangerTopAt(x: number) {
  const t = (Math.max(-0.33, Math.min(0.33, x)) / 0.33 + 1) / 2
  return -0.233 * ((1 - t) ** 2 + t ** 2) + 2 * t * (1 - t) * -0.072 - 0.015
}

function teeHangerGeometry() {
  return cached('hanger:tee', () => {
    const s = new THREE.Shape()
    // Sits just under the shoulder seams so the fabric drapes over it.
    s.moveTo(-0.33, -0.233)
    s.quadraticCurveTo(0, -0.072, 0.33, -0.233)
    s.quadraticCurveTo(0.354, -0.25, 0.33, -0.266)
    s.quadraticCurveTo(0, -0.112, -0.33, -0.266)
    s.quadraticCurveTo(-0.354, -0.25, -0.33, -0.233)
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 3, curveSegments: 32 })
    g.translate(0, -0.015, -0.01)
    return g
  })
}

/** A wooden hanger in hanger space: rail centre at the origin, garment hanging into -y. */
export function createHanger() {
  const { wood, chrome, brushed } = getHardwareMaterials()
  const group = new THREE.Group()
  group.name = 'hanger'
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    group.add(mesh)
    return mesh
  }

  add(hookGeometry(-0.17), chrome)
  add(teeHangerGeometry(), wood)
  const ferrule = add(cached('ferrule', () => new THREE.CylinderGeometry(0.0105, 0.0105, 0.016, 20)), brushed)
  ferrule.position.y = -0.166
  return group
}

/** Chrome rail with end sockets and wall plates, centred on the origin. */
export function createRail(length: number) {
  const { chrome, brushed } = getHardwareMaterials()
  const group = new THREE.Group()
  group.name = 'rail'

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(ROD_RADIUS, ROD_RADIUS, length, 40), chrome)
  rod.rotation.z = Math.PI / 2
  rod.castShadow = true
  group.add(rod)

  const socket = new THREE.CylinderGeometry(0.036, 0.034, 0.07, 36)
  const plate = new THREE.CylinderGeometry(0.078, 0.078, 0.018, 48)
  const screw = new THREE.SphereGeometry(0.009, 12, 8)
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(socket, chrome)
    s.rotation.z = Math.PI / 2
    s.position.x = side * (length / 2 + 0.025)
    s.castShadow = true
    group.add(s)

    const p = new THREE.Mesh(plate, brushed)
    p.rotation.z = Math.PI / 2
    p.position.x = side * (length / 2 + 0.068)
    p.castShadow = true
    group.add(p)

    for (const dy of [-0.05, 0.05]) {
      const sc = new THREE.Mesh(screw, chrome)
      sc.position.set(side * (length / 2 + 0.078), dy, 0)
      sc.scale.set(0.5, 1, 1)
      group.add(sc)
    }
  }
  return group
}
