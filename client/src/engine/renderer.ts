import * as THREE from 'three';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
}

/** WebGL2 renderer, lights and fog. */
export function createRenderContext(container: HTMLElement): RenderContext {
  // Stencil: silhouette shadows darken each covered pixel once.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d24);
  scene.fog = new THREE.Fog(0x1b1d24, 25, 90);

  scene.add(new THREE.HemisphereLight(0xc8cfdd, 0x4a4030, 1.6));
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -25; s.right = 25; s.top = 25; s.bottom = -25; s.near = 1; s.far = 80;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  return { renderer, scene };
}
