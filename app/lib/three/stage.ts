import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  key: THREE.DirectionalLight
  size: { width: number, height: number }
  dispose: () => void
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Transparent renderer with studio lighting: a soft key light that throws a
 * faint shadow onto an invisible back wall, and a room environment so the
 * chrome rail has something to reflect.
 */
export function createStage(container: HTMLElement, onResize: (stage: Stage) => void, options: { shadows?: boolean, fov?: number } = {}): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.shadowMap.enabled = options.shadows ?? true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const envMap = pmrem.fromScene(room, 0.04).texture
  room.dispose()
  pmrem.dispose()
  scene.environment = envMap
  scene.environmentIntensity = 0.55

  const camera = new THREE.PerspectiveCamera(options.fov ?? 28, 1, 0.1, 80)

  scene.add(new THREE.HemisphereLight('#ffffff', '#d9d1c3', 0.55))
  const key = new THREE.DirectionalLight('#fff4e6', 1.75)
  key.position.set(-1.4, 2.4, 6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.left = -3.6
  key.shadow.camera.right = 3.6
  key.shadow.camera.top = 2.4
  key.shadow.camera.bottom = -2.4
  key.shadow.camera.near = 1
  key.shadow.camera.far = 14
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.02
  key.shadow.radius = 5
  scene.add(key)
  const rim = new THREE.DirectionalLight('#e6ecff', 0.45)
  rim.position.set(3, 1.5, -2)
  scene.add(rim)

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.ShadowMaterial({ opacity: 0.05 }))
  wall.position.z = -0.9
  wall.receiveShadow = true
  scene.add(wall)

  const stage: Stage = {
    renderer,
    scene,
    camera,
    key,
    size: { width: 1, height: 1 },
    dispose() {
      observer.disconnect()
      envMap.dispose()
      wall.geometry.dispose()
      ;(wall.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }

  const resize = () => {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    stage.size = { width, height }
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    onResize(stage)
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  return stage
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt))
}

/** Camera distance that fits a world-space width/height into the view. */
export function fitDistance(camera: THREE.PerspectiveCamera, width: number, height: number) {
  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const distH = height / 2 / Math.tan(vFov / 2)
  const distW = width / 2 / (Math.tan(vFov / 2) * camera.aspect)
  return Math.max(distH, distW)
}
