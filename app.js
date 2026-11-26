const select = (selector) => document.querySelector(selector);
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const treeCanvas = select('#tree');
const cameraButton = select('#camera-toggle');
const cameraPreview = select('#camera-preview');
const cameraVideo = select('#camera-video');
const cameraStatus = select('#camera-status');
const gestureLabel = select('#gesture-label');
const photoStrip = select('#photo-strip');
const photoInput = select('#photo-files');
const photoStatus = select('#photo-status');
const photoDialog = select('#photo-dialog');
const focusedPhoto = select('#focused-photo');
const guidance = select('#guidance');
const defaultGuidance = guidance.textContent;
const photoLimit = 12;

let scene;
let mode = 'tree';
let cameraSession;
let gestureFocused = false;
let photos = [
  { id: 'winter', name: '节日装饰', url: './winter.jpg' },
  { id: 'lights', name: '冬日松枝', url: './lights.jpg' },
  { id: 'gift', name: '节日礼物', url: './gift.jpg' },
];
let personalPhotos = false;
let focusedPhotoIndex = -1;
let photoTouchStartX = null;

function showStatus(element, message = '') {
  element.textContent = message;
  element.hidden = !message;
}

function chooseMode(nextMode) {
  mode = nextMode;
  scene?.setMode(mode);
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
}

function focusPhoto(id, fromGesture = false) {
  const photoIndex = photos.findIndex((item) => item.id === id);
  const photo = photos[photoIndex];
  if (!photo) return;
  focusedPhotoIndex = photoIndex;
  focusedPhoto.src = photo.url;
  focusedPhoto.alt = photo.name;
  select('#photo-title').textContent = photo.name;
  gestureFocused = fromGesture;
  if (!photoDialog.open) photoDialog.showModal();
}

function moveFocusedPhoto(step) {
  if (!photos.length || focusedPhotoIndex < 0) return;
  const nextIndex = (focusedPhotoIndex + step + photos.length) % photos.length;
  focusPhoto(photos[nextIndex].id, gestureFocused);
}

function renderPhotos() {
  const thumbnails = photos.map((photo) => {
    const button = document.createElement('button');
    button.className = 'thumbnail';
    button.type = 'button';
    button.setAttribute('aria-label', `查看${photo.name}`);
    const image = new Image();
    image.alt = '';
    image.src = photo.url;
    button.append(image);
    button.addEventListener('click', () => focusPhoto(photo.id));
    return button;
  });
  photoStrip.replaceChildren(...thumbnails);
  select('#gallery-title').textContent = personalPhotos ? `我的照片 · ${photos.length}/${photoLimit}` : '示例照片';
  scene?.setPhotos(photos);
}

async function readPhoto(file) {
  const inputUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = inputUrl;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height) throw new Error('Empty image');
    const scale = Math.min(1, 1200 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#14271b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Image encoding failed');
    const url = URL.createObjectURL(blob);
    return {
      id: url,
      name: file.name.replace(/\.[^.]+$/, '') || '我的照片',
      url,
    };
  } finally {
    URL.revokeObjectURL(inputUrl);
  }
}

function handleGesture(gesture, x, y) {
  const labels = { search: '寻找手掌', tracking: '已看到手掌', open: '张开手掌', fist: '握拳', pinch: '拇指食指捏合' };
  gestureLabel.textContent = labels[gesture];
  if (gesture === 'open' || gesture === 'fist') {
    if (gestureFocused && photoDialog.open) photoDialog.close();
    chooseMode(gesture === 'open' ? 'scatter' : 'tree');
  }
  if (gesture === 'pinch' && !photoDialog.open && photos.length) {
    const picked = scene?.pickImage(x, y);
    if (picked) gestureFocused = true;
    else focusPhoto(photos[0].id, true);
  }
}

function stopCamera(message = '') {
  cameraSession?.controller.abort();
  cameraSession?.stream?.getTracks().forEach((track) => track.stop());
  cameraSession = undefined;
  cameraVideo.srcObject = null;
  cameraPreview.hidden = true;
  cameraButton.disabled = false;
  cameraButton.textContent = '开启手势';
  cameraButton.setAttribute('aria-pressed', 'false');
  guidance.textContent = defaultGuidance;
  scene?.steer(0);
  showStatus(cameraStatus, message);
}

async function startCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showStatus(cameraStatus, '手机请通过 HTTPS 网页开启摄像头。你也可以直接触屏操作。');
    return;
  }

  const session = { controller: new AbortController(), stream: null };
  cameraSession = session;
  cameraButton.disabled = true;
  cameraButton.textContent = '正在请求摄像头…';
  showStatus(cameraStatus);
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
    });
    if (session.controller.signal.aborted) {
      session.stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const track = session.stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (cameraSession === session) stopCamera('摄像头已断开，可重新开启。');
    }, { once: true });
    cameraVideo.srcObject = session.stream;
    cameraPreview.hidden = false;
    gestureLabel.textContent = '正在加载模型';
    cameraButton.textContent = '正在加载手势…';
    await cameraVideo.play();
    const { watchGestures } = await import('./gestures.js');
    await watchGestures(cameraVideo, {
      onGesture: handleGesture,
      onPosition: (x) => scene?.steer(x),
      onError: (error) => {
        console.error(error);
        stopCamera('手势识别中断，可以重新开启或继续触屏操作。');
      },
    }, session.controller.signal);
    if (session.controller.signal.aborted) return;
    cameraButton.disabled = false;
    cameraButton.textContent = '关闭手势';
    cameraButton.setAttribute('aria-pressed', 'true');
    gestureLabel.textContent = '寻找手掌';
    guidance.textContent = '张手散开 · 握拳聚拢 · 捏合查看照片';
  } catch (error) {
    if (cameraSession !== session) return;
    if (error.name === 'NotAllowedError') {
      stopCamera('浏览器未授予摄像头权限。可在网站设置里允许，或直接触屏操作。');
    } else {
      console.error(error);
      stopCamera('摄像头或手势模型启动失败，可重新开启或直接触屏操作。');
    }
  }
}

for (const button of modeButtons) button.addEventListener('click', () => chooseMode(button.dataset.mode));
cameraButton.addEventListener('click', () => cameraSession ? stopCamera() : startCamera());
select('#close-photo').addEventListener('click', () => photoDialog.close());
select('#previous-photo').addEventListener('click', () => moveFocusedPhoto(-1));
select('#next-photo').addEventListener('click', () => moveFocusedPhoto(1));
focusedPhoto.addEventListener('touchstart', (event) => {
  photoTouchStartX = event.changedTouches[0]?.clientX ?? null;
}, { passive: true });
focusedPhoto.addEventListener('touchend', (event) => {
  if (photoTouchStartX == null) return;
  const distance = event.changedTouches[0].clientX - photoTouchStartX;
  photoTouchStartX = null;
  if (Math.abs(distance) > 42) moveFocusedPhoto(distance < 0 ? 1 : -1);
}, { passive: true });
photoDialog.addEventListener('click', (event) => {
  if (event.target === photoDialog) photoDialog.close();
});
photoDialog.addEventListener('close', () => { gestureFocused = false; focusedPhotoIndex = -1; photoTouchStartX = null; });
select('#add-photos').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', async () => {
  const available = personalPhotos ? photoLimit - photos.length : photoLimit;
  const files = [...photoInput.files];
  const addButton = select('#add-photos');
  photoInput.value = '';
  if (!files.length) return;
  if (!available) {
    showStatus(photoStatus, `已添加 ${photoLimit} 张照片。`);
    return;
  }
  addButton.disabled = true;
  showStatus(photoStatus, '正在添加照片…');
  const accepted = [];
  let failures = 0;
  for (const file of files.slice(0, available)) {
    try { accepted.push(await readPhoto(file)); }
    catch { failures += 1; }
  }
  if (accepted.length) {
    photos = [...(personalPhotos ? photos : []), ...accepted];
    personalPhotos = true;
    renderPhotos();
  }
  addButton.disabled = false;
  const notes = [];
  if (failures) notes.push(`${failures} 张照片无法读取，请尝试 JPG 或 PNG 格式。`);
  if (files.length > available) notes.push(`最多可添加 ${photoLimit} 张照片。`);
  showStatus(photoStatus, notes.join(' '));
});
window.addEventListener('pagehide', () => stopCamera());

renderPhotos();
try {
  const { createTreeScene } = await import('./scene.js');
  scene = createTreeScene(treeCanvas, { onPhoto: focusPhoto });
  scene.setMode(mode);
  scene.setPhotos(photos);
  document.addEventListener('visibilitychange', () => scene.setActive(!document.hidden));
} catch (error) {
  console.error(error);
  select('#scene-fallback').hidden = false;
}

