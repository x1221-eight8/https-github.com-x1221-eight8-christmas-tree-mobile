import { FilesetResolver, GestureRecognizer } from './vision_bundle.mjs';

let detectorPromise;

async function getDetector() {
  detectorPromise ??= (async () => {
    const wasmPath = new URL('.', import.meta.url).href;
    const modelPath = new URL('./gesture_recognizer.task', import.meta.url).href;
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    return GestureRecognizer.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
  })().catch((error) => {
    detectorPromise = undefined;
    throw error;
  });
  return detectorPromise;
}

function classify(points, category, aspect, pinched) {
  if (category?.categoryName === 'Closed_Fist' && category.score >= 0.65) return 'fist';
  const distance = (a, b) => Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
  const palm = Math.max(distance(0, 9), distance(5, 17));
  if (palm >= 0.035 && distance(5, 8) > palm * 0.32 && distance(4, 8) < palm * (pinched ? 0.41 : 0.27)) {
    return 'pinch';
  }
  if (category?.categoryName === 'Open_Palm' && category.score >= 0.6) return 'open';
  return 'tracking';
}

export async function watchGestures(video, { onGesture, onPosition, onError }, signal) {
  const detector = await getDetector();
  if (signal.aborted) return;

  let lastVideoTime = -1;
  let lastRun = 0;
  let frame = 0;
  let candidate = 'search';
  let candidateSince = 0;
  let confirmed = 'search';
  function update(now) {
    if (signal.aborted) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastRun >= 75) {
      lastRun = now;
      lastVideoTime = video.currentTime;
      try {
        const result = detector.recognizeForVideo(video, performance.now());
        const points = result.landmarks[0];
        const category = result.gestures[0]?.[0];
        const next = points ? classify(points, category, video.videoWidth / video.videoHeight, confirmed === 'pinch') : 'search';
        if (next !== candidate) {
          candidate = next;
          candidateSince = now;
        } else if (candidate !== confirmed && now - candidateSince >= 140) {
          confirmed = candidate;
          const x = points ? 1 - (points[4].x + points[8].x) : 0;
          const y = points ? 1 - (points[4].y + points[8].y) : 0;
          onGesture(confirmed, x, y);
        }
        if (points && confirmed !== 'pinch') onPosition(Math.max(-1, Math.min(1, (0.5 - points[9].x) * 3)));
      } catch (error) {
        onError(error);
        return;
      }
    }
    frame = requestAnimationFrame(update);
  }

  signal.addEventListener('abort', () => cancelAnimationFrame(frame), { once: true });
  frame = requestAnimationFrame(update);
}

