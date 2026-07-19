import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import * as THREE from "three";
import { camera, hands, isRigActive, updateHandView } from "../webgl";
import { setStatus } from "./status";

let handLandmarker: HandLandmarker | null = null;
let video: HTMLVideoElement | null = null;

export const initHandTracking = async () => {
	setStatus("Loading model…");
	const vision = await FilesetResolver.forVisionTasks(
		"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
	);
	handLandmarker = await HandLandmarker.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath:
				"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
			delegate: "GPU",
		},
		runningMode: "VIDEO",
		numHands: 2,
	});

	setStatus("Please allow camera access");
	const stream = await navigator.mediaDevices.getUserMedia({
		video: { width: 640, height: 480, facingMode: "user" },
	});
	const v = document.createElement("video");
	v.autoplay = true;
	v.playsInline = true;
	v.muted = true;
	v.style.display = "none";
	document.body.appendChild(v);
	v.srcObject = stream;
	await v.play();
	video = v;

	setStatus("Show your hand to the camera", false);
};

const tmpTarget = new THREE.Vector3();

export const updateHand = () => {
	if (!handLandmarker || !video || video.readyState < 2) return;

	const now = performance.now();
	const result = handLandmarker.detectForVideo(video, now);

	const detected = result.landmarks.length;
	if (detected === 0) {
		for (const h of hands) {
			h.detected = false;
			h.smoothingInitialized = false;
		}
		return;
	}

	const visibleHeight =
		2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
	const visibleWidth = visibleHeight * camera.aspect;
	const depthScale = 8;

	let anyDetectedBefore = false;
	for (const h of hands) if (h.detected) anyDetectedBefore = true;
	const rigActive = isRigActive();

	for (let hIdx = 0; hIdx < hands.length; hIdx++) {
		const h = hands[hIdx];
		if (hIdx >= detected) {
			h.detected = false;
			h.smoothingInitialized = false;
			continue;
		}
		h.detected = true;
		h.label = result.handedness[hIdx]?.[0]?.categoryName ?? "";
		const landmarks = result.landmarks[hIdx];
		for (let i = 0; i < 21; i++) {
			const lm = landmarks[i];
			tmpTarget.set(
				(0.5 - lm.x) * visibleWidth,
				(0.5 - lm.y) * visibleHeight,
				lm.z * depthScale,
			);
			if (!h.smoothingInitialized) h.smoothed[i].copy(tmpTarget);
			else h.smoothed[i].lerp(tmpTarget, 0.45);
		}
		h.smoothingInitialized = true;
		if (!rigActive) updateHandView(h);
	}

	if (!anyDetectedBefore) setStatus("", true);
};
