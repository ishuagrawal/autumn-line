import * as THREE from 'three';
import { MAIN, groundHeight } from '../core/layout';
import { toonMaterial } from '../render/toon';

// Line-side furniture visible in the photo: an old pole with a leaning
// companion (left), a slim post (right) and a short grey fence at the curve.

function place(obj: THREE.Object3D, s: number, u: number, yawExtra = 0): void {
  const p = MAIN.point(s, u);
  obj.position.set(p.x, groundHeight(p.x, p.z), p.z);
  obj.rotation.y = -p.th + yawExtra;
}

export function buildProps(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'props';
  const wood = toonMaterial({ color: 0x7b6d62, pattern: 'bark', outline: 1, rim: 0.2 });
  const grey = toonMaterial({ color: 0xa7a09a, pattern: 'wood', outline: 1, rim: 0.2 });
  const dark = toonMaterial({ color: 0x3e342f, outline: 1, rim: 0.15 });

  // left pole + leaning pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.12, 4.1, 8), wood);
  pole.geometry.translate(0, 2.05, 0);
  pole.rotation.z = 0.02;
  const poleGrp = new THREE.Group();
  poleGrp.add(pole);
  const lean = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 7), wood);
  lean.geometry.translate(0, 1.7, 0);
  lean.position.set(0.9, 0, 0.3);
  lean.rotation.z = 0.5;
  poleGrp.add(lean);
  place(poleGrp, 121, -5.6);
  g.add(poleGrp);

  // slim dark post on the right
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, 2.5, 0.11), dark);
  post.geometry.translate(0, 1.25, 0);
  place(post, 93, 2.75, 0.3);
  g.add(post);

  // short fence section (culvert guard)
  const fence = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.8, 0.05), grey);
    slat.position.set(0, 0.4, -0.7 + i * 0.35);
    slat.rotation.x = (i % 2 ? 1 : -1) * 0.03;
    fence.add(slat);
  }
  for (const y of [0.25, 0.66]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 1.55), grey);
    rail.position.set(0.05, y, 0);
    fence.add(rail);
  }
  place(fence, 101, 3.0);
  g.add(fence);

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
