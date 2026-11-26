import * as THREE from "./three.module.min.js";

const GOLD = 0xffc47a;
const TREE_BOTTOM = -2.28;
const TREE_HEIGHT = 4.94;
const PHOTO_SLOTS = [
  [-0.91, -0.12, 0.99],
  [0.91, -1.19, 1.26],
  [0.56, 0.91, 0.72],
  [-1.28, -1.63, -0.72],
  [0.02, -1.61, -1.81],
  [0.01, 0.45, -1.06],
  [1.46, -1.57, -0.68],
  [-0.74, -0.58, -1.17],
  [0.16, 1.40, 0.55],
  [-0.48, -1.27, 1.58],
  [1.38, -1.65, 0.35],
  [-0.9, -0.52, 0.68],
];
const FLOATING_SLOTS = [
  [-1.52, 0.74, 0.84], [1.32, -0.84, 1.20], [0.91, 1.36, 0.65],
  [-1.21, -1.38, -0.47], [0.12, -1.8, -1.42], [0.1, 0.6, -1.27],
  [1.45, 0.32, -0.98], [-1.38, 0.4, -1.05], [0.43, 1.76, 0.80],
  [-0.67, -1.64, 0.95], [1.48, -1.5, 0.13], [-1.5, -0.13, 0.47],
];

function seededRandom(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function branchWidth(height, angle) {
  const tier = ((height * 8.5) % 1);
  const needles = 0.79 + 0.21 * Math.cos(tier * Math.PI);
  const branch = 0.90 + 0.10 * Math.cos(angle * 7 + height * 21);
  return (2.06 * Math.pow(1 - height, 0.84) + 0.045) * needles * branch;
}

function cloudPosition(random, extent) {
  const direction = random() * Math.PI * 2;
  const height = random() * 2 - 1;
  const radial = Math.sqrt(1 - height * height) * (0.37 + 0.63 * Math.sqrt(random()));
  return new THREE.Vector3(
    Math.cos(direction) * radial * extent,
    height * 2.34 + 0.18,
    Math.sin(direction) * radial * extent * 0.84,
  );
}

function makePointCloud(count, sample, { style, blend, density }) {
  const positions = new Float32Array(count * 3);
  const scattered = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const point = sample(i);
    point.position.toArray(positions, i * 3);
    (point.scattered ?? point.position).toArray(scattered, i * 3);
    point.color.toArray(colors, i * 3);
    sizes[i] = point.size;
    phases[i] = point.phase;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("scatteredPosition", new THREE.BufferAttribute(scattered, 3));
  geo.setAttribute("pointColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBlend: { value: 0 },
      uTime: { value: 0 },
      uDensity: { value: density },
      uStyle: { value: style },
    },
    transparent: true,
    depthWrite: false,
    blending: blend,
    vertexShader: `
      attribute vec3 scatteredPosition;
      attribute vec3 pointColor;
      attribute float pointSize;
      attribute float phase;
      uniform float uBlend;
      uniform float uTime;
      uniform float uDensity;
      uniform float uStyle;
      varying vec3 vColor;
      varying float vOpacity;
      varying float vPhase;
      void main() {
        vec3 p = mix(position, scatteredPosition, smoothstep(0.0, 1.0, uBlend));
        if (uStyle > 1.5) {
          p.y = mod(p.y + 3.55 - uTime * (0.15 + phase * 0.027), 7.1) - 3.55;
          p.x += sin(uTime * 0.43 + phase + p.y * 0.6) * 0.21;
        } else {
          p.x += sin(uTime * 0.9 + phase) * 0.07 * uBlend;
          p.y += cos(uTime * 0.7 + phase * 1.3) * 0.09 * uBlend;
        }
        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = max(1.0, pointSize * uDensity / max(1.0, -viewPosition.z));
        vColor = pointColor;
        vPhase = phase;
        float pulse = 0.70 + 0.30 * sin(uTime * (1.1 + phase * 0.19) + phase);
        vOpacity = uStyle < 0.5 ? 0.78 : pulse;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;
      varying float vPhase;
      uniform float uStyle;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float r = length(p) * 2.0;
        float core = 1.0 - smoothstep(0.12, 0.55, r);
        float halo = (1.0 - smoothstep(0.08, 1.0, r)) * 0.36;
        float alpha = uStyle < 0.5 ? 1.0 - smoothstep(0.2, 0.99, r) : core + halo;
        if (uStyle > 0.5 && uStyle < 1.5) {
          float ray = min(abs(p.x), abs(p.y));
          alpha += 0.23 * (1.0 - smoothstep(0.0, 0.072, ray)) * (1.0 - smoothstep(0.12, 0.97, r));
        }
        if (alpha < 0.018) discard;
        gl_FragColor = vec4(vColor, alpha * vOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return points;
}

function makeFoliage(random) {
  const palette = [0x225d49, 0x387f64, 0x2a7355, 0x59a984, 0x134c3c, 0x487e5d]
    .map((color) => new THREE.Color(color));
  return makePointCloud(4400, () => {
    const height = 1 - Math.pow(random(), 0.73);
    const angle = random() * Math.PI * 2;
    const width = branchWidth(height, angle) * (0.25 + 0.75 * Math.sqrt(random()));
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * width,
        TREE_BOTTOM + height * TREE_HEIGHT + (random() - 0.5) * 0.12,
        Math.sin(angle) * width,
      ),
      scattered: cloudPosition(random, 2.13),
      color: palette[Math.floor(random() * palette.length)],
      // Keep the needles legible on a phone-sized canvas. The original point
      // size looked like a sparse constellation at a portrait viewport.
      size: 7.2 + random() * 11.5,
      phase: random() * 6.3,
    };
  }, { style: 0, blend: THREE.NormalBlending, density: 1 });
}

function makeEvergreenLayers() {
  const group = new THREE.Group();
  const layers = [
    { y: -1.87, radius: 1.75, height: 1.48, color: 0x164a39 },
    { y: -1.05, radius: 1.48, height: 1.42, color: 0x1b5a43 },
    { y: -0.24, radius: 1.18, height: 1.32, color: 0x236b4d },
    { y: 0.52, radius: 0.88, height: 1.18, color: 0x2d7955 },
    { y: 1.21, radius: 0.58, height: 0.98, color: 0x3a8a60 },
  ];
  for (const { y, radius, height, color } of layers) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.92,
      metalness: 0,
      emissive: color,
      emissiveIntensity: 0.13,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 48, 1, true), material);
    mesh.position.y = y;
    group.add(mesh);
  }
  group.renderOrder = 0;
  return group;
}

function makeFairyLights(random) {
  const palette = [0xffdd9a, 0xffb64f, 0xffedc6, 0xfa9d49, 0xf9efd7]
    .map((color) => new THREE.Color(color));
  return makePointCloud(510, (i) => {
    const height = 0.045 + 0.93 * (i / 509);
    const angle = height * Math.PI * 2 * 6.3 + (random() - 0.5) * 1.25;
    const width = branchWidth(height, angle) * (1.02 + random() * 0.15);
    const highlighted = i % 17 === 0;
    return {
      position: new THREE.Vector3(
        Math.cos(angle) * width,
        TREE_BOTTOM + height * TREE_HEIGHT + (random() - 0.5) * 0.15,
        Math.sin(angle) * width,
      ),
      scattered: cloudPosition(random, 2.27),
      color: palette[Math.floor(random() * palette.length)],
      size: (highlighted ? 18 : 6) + random() * (highlighted ? 20 : 10),
      phase: random() * 6.3,
    };
  }, { style: 1, blend: THREE.AdditiveBlending, density: 1 });
}

function makeSnow(random) {
  const palette = [0x85bdad, 0xbad8ce, 0xe0e7d5, 0xe8d9ab].map((color) => new THREE.Color(color));
  return makePointCloud(540, () => ({
    position: new THREE.Vector3((random() - 0.5) * 13, (random() - 0.5) * 7.1, (random() - 0.5) * 8),
    color: palette[Math.floor(random() * palette.length)],
    size: 2.5 + random() * random() * 7.5,
    phase: random() * 6.3,
  }), { style: 2, blend: THREE.NormalBlending, density: 1 });
}

function makeOrnaments(random) {
  const count = 112;
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.32 });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  const palette = [0xf8c15d, 0xc48242, 0xefa747, 0xb34437, 0x7e332c, 0xf9dfa8];
  const items = Array.from({ length: count }, (_, i) => {
    const height = 0.035 + (1 - Math.pow(random(), 0.65)) * 0.88;
    const angle = random() * Math.PI * 2;
    const width = branchWidth(height, angle) * (0.92 + random() * 0.17);
    mesh.setColorAt(i, new THREE.Color(palette[Math.floor(random() * palette.length)]));
    return {
      home: new THREE.Vector3(Math.cos(angle) * width, TREE_BOTTOM + height * TREE_HEIGHT, Math.sin(angle) * width),
      away: cloudPosition(random, 2.23),
      scale: 0.031 + random() * 0.068,
      angle,
    };
  });
  const part = new THREE.Object3D();
  const update = (blend) => {
    for (const [index, item] of items.entries()) {
      part.position.lerpVectors(item.home, item.away, blend);
      part.rotation.set(item.angle, item.angle * 0.4, 0);
      part.scale.setScalar(item.scale);
      part.updateMatrix();
      mesh.setMatrixAt(index, part.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  return { mesh, update };
}

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 1, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,244,205,0.92)");
  gradient.addColorStop(0.14, "rgba(255,222,149,0.52)");
  gradient.addColorStop(0.43, "rgba(255,184,89,0.15)");
  gradient.addColorStop(1, "rgba(255,184,89,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeStar() {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + Math.PI * i / 5;
    const radius = i % 2 === 0 ? 0.37 : 0.15;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.023, bevelSegments: 2,
  });
  const material = new THREE.MeshStandardMaterial({
    color: 0xffe5a8, emissive: 0xffb347, emissiveIntensity: 0.82, roughness: 0.25, metalness: 0.18,
  });
  const body = new THREE.Mesh(geometry, material);
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
  }));
  aura.scale.set(1.54, 1.54, 1);
  aura.position.z = -0.045;
  group.add(body, aura);
  return { group, body, aura };
}

function makePedestal() {
  const group = new THREE.Group();
  group.position.y = TREE_BOTTOM - 0.18;
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xddae68, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.13, 2.14, 112), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);
  const inner = new THREE.Mesh(new THREE.RingGeometry(1.72, 1.729, 96), ringMaterial);
  inner.rotation.x = -Math.PI / 2;
  group.add(inner);
  const disk = new THREE.Mesh(
    new THREE.PlaneGeometry(5.7, 5.7),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x65836b, opacity: 0.21, transparent: true, depthWrite: false }),
  );
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = -0.016;
  group.add(disk);
  return group;
}

export function createTreeScene(canvas, { onPhoto = () => {} } = {}) {
  const random = seededRandom(1729);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 35);
  const tree = new THREE.Group();
  scene.add(tree, makePedestal());

  const hemi = new THREE.HemisphereLight(0xfde4c4, 0x284b3d, 2.45);
  const key = new THREE.DirectionalLight(0xffe9c0, 3.6);
  key.position.set(-4, 6, 7);
  const rim = new THREE.DirectionalLight(0x6fbaa1, 1.8);
  rim.position.set(3, 2, -5);
  scene.add(hemi, key, rim);

  const needles = makeFoliage(random);
  const evergreenLayers = makeEvergreenLayers();
  const lights = makeFairyLights(random);
  const snow = makeSnow(random);
  const ornaments = makeOrnaments(random);
  const star = makeStar();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.18, 0.63, 12),
    new THREE.MeshStandardMaterial({ color: 0x3e3528, roughness: 0.9 }),
  );
  trunk.position.y = TREE_BOTTOM + 0.075;
  tree.add(trunk, evergreenLayers, needles, lights, ornaments.mesh, star.group);
  scene.add(snow);
  // Translucent needles sit behind the solid ornaments and the bright pin lights.
  needles.renderOrder = 1;
  lights.renderOrder = 3;
  snow.renderOrder = 4;

  const photoFrame = new THREE.PlaneGeometry(0.65, 0.75);
  const photoMat = new THREE.MeshBasicMaterial({ color: GOLD });
  const photoBacking = new THREE.MeshBasicMaterial({ color: 0x291c18 });
  const photoMatte = new THREE.MeshBasicMaterial({ color: 0xecd5a6 });
  const photoInset = new THREE.PlaneGeometry(0.594, 0.696);
  const photoFace = new THREE.PlaneGeometry(0.544, 0.598);
  const photoReverse = new THREE.PlaneGeometry(0.634, 0.736);
  const loader = new THREE.TextureLoader();
  const photosById = new Map();
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const cameraRotation = new THREE.Quaternion();
  const treeRotation = new THREE.Quaternion();
  let photoCards = [];
  let blend = 0;
  let blendTarget = 0;
  let active = true;
  let animationRequest = 0;
  let drag = null;
  let angle = 0;
  let angleTarget = 0;
  let handAngle = 0;
  let lastTime = 0;
  let elapsed = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    const minimumDistance = 8.6;
    const widthDistance = 2.31 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    camera.position.set(0, 0.80, Math.max(minimumDistance, widthDistance));
    camera.lookAt(0, 0.25, 0);
    camera.updateProjectionMatrix();
    for (const cloud of [needles, lights, snow]) {
      cloud.material.uniforms.uDensity.value = rect.height * renderer.getPixelRatio() / 540;
    }
    if (!active) renderer.render(scene, camera);
  }

  function updatePhoto(card) {
    card.group.position.lerpVectors(card.home, card.away, blend);
    card.group.position.y += Math.sin(elapsed * 1.4 + card.phase) * (0.034 + blend * 0.043);
    card.group.quaternion.copy(treeRotation).multiply(cameraRotation);
    card.group.rotateZ(card.tilt + Math.sin(elapsed * 0.8 + card.phase) * 0.026);
  }

  function animate(now) {
    if (!active) return;
    const seconds = lastTime === 0 ? 1 / 60 : Math.min((now - lastTime) / 1000, 0.045);
    lastTime = now;
    elapsed += reducedMotion ? 0 : seconds;
    const previousBlend = blend;
    blend = reducedMotion ? blendTarget : THREE.MathUtils.damp(blend, blendTarget, 5.1, seconds);
    if (Math.abs(blend - blendTarget) < 0.001) blend = blendTarget;
    if (previousBlend !== blend) {
      ornaments.update(THREE.MathUtils.smoothstep(blend, 0, 1));
      trunk.scale.setScalar(1 - blend * 0.85);
      trunk.visible = blend < 0.83;
    evergreenLayers.scale.setScalar(Math.max(0, 1 - blend * 4.5));
    }
    if (!drag && Math.abs(handAngle) < 0.01 && !reducedMotion) angleTarget += seconds * (0.137 - 0.048 * blend);
    angle = THREE.MathUtils.damp(angle, angleTarget + handAngle, 6, seconds);
    tree.rotation.y = angle;

    for (const cloud of [needles, lights, snow]) {
      cloud.material.uniforms.uTime.value = elapsed;
      cloud.material.uniforms.uBlend.value = blend;
    }
    star.group.position.set(0.42 * blend, 2.63 - 0.22 * blend, 0.14 + 0.28 * blend);
    star.body.rotation.y = -angle * 0.72 + Math.sin(elapsed * 0.68) * 0.32;
    star.aura.material.opacity = 0.68 + 0.16 * Math.sin(elapsed * 1.7);
    camera.getWorldQuaternion(cameraRotation);
    treeRotation.copy(tree.quaternion).invert();
    for (const card of photoCards) updatePhoto(card);
    renderer.render(scene, camera);
    animationRequest = requestAnimationFrame(animate);
  }

  function makePhotoCard(photo, index) {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(photoFrame, photoMat);
    const backing = new THREE.Mesh(photoReverse, photoBacking);
    backing.rotateY(Math.PI);
    backing.position.z = -0.004;
    const matte = new THREE.Mesh(photoInset, photoMatte);
    matte.position.z = 0.006;
    const imageMaterial = new THREE.MeshBasicMaterial({ color: 0x506b57 });
    const photoImage = new THREE.Mesh(photoFace, imageMaterial);
    photoImage.position.set(0, 0.023, 0.011);
    frame.userData.photoId = photo.id;
    group.add(frame, backing, matte, photoImage);
    const card = {
      group, frame, imageMaterial, url: photo.url,
      home: new THREE.Vector3(...PHOTO_SLOTS[index]),
      away: new THREE.Vector3(...FLOATING_SLOTS[index]),
      phase: index * 1.372,
      tilt: index % 2 === 0 ? -0.11 : 0.09,
    };
    group.position.copy(card.home);
    loader.load(photo.url, (texture) => {
      if (photosById.get(photo.id) !== card) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      const ratio = texture.image.width / texture.image.height;
      const frameRatio = 0.544 / 0.598;
      if (ratio > frameRatio) texture.repeat.x = frameRatio / ratio;
      else texture.repeat.y = ratio / frameRatio;
      texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
      imageMaterial.map = texture;
      imageMaterial.color.set(0xffffff);
      imageMaterial.needsUpdate = true;
      if (!active) renderer.render(scene, camera);
    }, undefined, () => {});
    tree.add(group);
    return card;
  }

  function setPhotos(photos) {
    const visiblePhotos = photos.slice(0, PHOTO_SLOTS.length);
    const newIds = new Set(visiblePhotos.map((photo) => photo.id));
    for (const [id, card] of photosById) {
      if (newIds.has(id) && visiblePhotos.find((photo) => photo.id === id).url === card.url) continue;
      tree.remove(card.group);
      card.imageMaterial.map?.dispose();
      card.imageMaterial.dispose();
      photosById.delete(id);
    }
    photoCards = visiblePhotos.map((photo, index) => {
      const existing = photosById.get(photo.id);
      if (existing) {
        existing.home.set(...PHOTO_SLOTS[index]);
        existing.away.set(...FLOATING_SLOTS[index]);
        return existing;
      }
      const card = makePhotoCard(photo, index);
      photosById.set(photo.id, card);
      return card;
    });
  }

  function hitPhoto(x, y, fallback) {
    pointer.set(x, y);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(photoCards.map((card) => card.frame), false)[0];
    let chosen = hit?.object.userData.photoId;
    if (chosen == null && fallback) {
      let distance = Infinity;
      for (const card of photoCards) {
        card.group.getWorldPosition(projected);
        projected.project(camera);
        const similarity = Math.hypot(projected.x - x, projected.y - y) + projected.z * 0.07;
        if (similarity < distance) {
          chosen = card.frame.userData.photoId;
          distance = similarity;
        }
      }
    }
    if (chosen != null) onPhoto(chosen);
    return chosen ?? null;
  }

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, angle: angleTarget };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) angleTarget = drag.angle + (event.clientX - drag.startX) * 0.012;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (drag?.id !== event.pointerId) return;
    const tap = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8;
    drag = null;
    if (!tap) return;
    const rect = canvas.getBoundingClientRect();
    hitPhoto(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2,
      false,
    );
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("lostpointercapture", () => { drag = null; });

  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  animationRequest = requestAnimationFrame(animate);

  return {
    setMode(mode) { blendTarget = mode === "scatter" ? 1 : 0; },
    setPhotos,
    steer(x) { handAngle = THREE.MathUtils.clamp(x, -1, 1) * 0.64; },
    pickImage(x, y) { return hitPhoto(x, y, true); },
    setActive(value) {
      if (active === value) return;
      active = value;
      if (active) {
        lastTime = 0;
        animationRequest = requestAnimationFrame(animate);
      } else {
        cancelAnimationFrame(animationRequest);
      }
    },
  };
}

