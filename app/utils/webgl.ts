/** True when the browser can create a WebGL2 context for the 3D rack. */
export function hasWebGL() {
  if (import.meta.server) return true
  try {
    const canvas = document.createElement('canvas')
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'))
  } catch {
    return false
  }
}
