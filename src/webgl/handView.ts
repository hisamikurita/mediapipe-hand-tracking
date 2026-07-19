import * as THREE from "three";
import {
	FINGER_CHAINS,
	FINGER_RADIUS,
	FINGER_TIPS,
	PALM_THICKNESS,
	TIP_RADIUS,
} from "./constants";
import { scene } from "./core";

const handMaterial = new THREE.MeshStandardMaterial({
	color: "#f2f0ec",
	metalness: 0,
	roughness: 0.55,
});
const tipGeometry = new THREE.SphereGeometry(TIP_RADIUS, 20, 16);
const wristGeometry = new THREE.SphereGeometry(FINGER_RADIUS * 1.5, 20, 16);
const palmGeometry = new THREE.SphereGeometry(1, 24, 18);

export interface HandView {
	group: THREE.Group;
	fingers: THREE.Mesh[];
	tips: THREE.Mesh[];
	wrist: THREE.Mesh;
	palm: THREE.Mesh;
	smoothed: THREE.Vector3[];
	smoothingInitialized: boolean;
	detected: boolean;
	label: string;
}

const createHandView = (): HandView => {
	const group = new THREE.Group();
	group.visible = false;
	scene.add(group);

	const fingers: THREE.Mesh[] = [];
	for (let i = 0; i < FINGER_CHAINS.length; i++) {
		const m = new THREE.Mesh(new THREE.BufferGeometry(), handMaterial);
		m.castShadow = true;
		group.add(m);
		fingers.push(m);
	}

	const tips: THREE.Mesh[] = [];
	for (let i = 0; i < FINGER_TIPS.length; i++) {
		const m = new THREE.Mesh(tipGeometry, handMaterial);
		m.castShadow = true;
		group.add(m);
		tips.push(m);
	}

	const wrist = new THREE.Mesh(wristGeometry, handMaterial);
	wrist.castShadow = true;
	group.add(wrist);

	const palm = new THREE.Mesh(palmGeometry, handMaterial);
	palm.castShadow = true;
	group.add(palm);

	return {
		group,
		fingers,
		tips,
		wrist,
		palm,
		smoothed: Array.from({ length: 21 }, () => new THREE.Vector3()),
		smoothingInitialized: false,
		detected: false,
		label: "",
	};
};

export const hands: HandView[] = [createHandView(), createHandView()];

const palmX = new THREE.Vector3();
const palmY = new THREE.Vector3();
const palmZ = new THREE.Vector3();
const palmMatrix = new THREE.Matrix4();

const updatePalm = (view: HandView) => {
	const p = view.smoothed;
	const center = view.palm.position;
	center
		.copy(p[0])
		.add(p[5])
		.add(p[9])
		.add(p[13])
		.add(p[17])
		.multiplyScalar(0.2);

	palmX.subVectors(p[17], p[5]).normalize();
	palmY.subVectors(p[9], p[0]).normalize();
	palmZ.crossVectors(palmX, palmY).normalize();
	palmY.crossVectors(palmZ, palmX).normalize();
	palmMatrix.makeBasis(palmX, palmY, palmZ);
	view.palm.quaternion.setFromRotationMatrix(palmMatrix);

	view.palm.scale.set(
		p[5].distanceTo(p[17]) * 0.5 + FINGER_RADIUS,
		p[0].distanceTo(p[9]) * 0.55,
		PALM_THICKNESS,
	);
};

export const updateHandView = (view: HandView) => {
	for (let i = 0; i < FINGER_CHAINS.length; i++) {
		const points = FINGER_CHAINS[i].map((idx) => view.smoothed[idx]);
		const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
		const mesh = view.fingers[i];
		mesh.geometry.dispose();
		mesh.geometry = new THREE.TubeGeometry(curve, 24, FINGER_RADIUS, 12, false);
	}
	for (let i = 0; i < FINGER_TIPS.length; i++) {
		view.tips[i].position.copy(view.smoothed[FINGER_TIPS[i]]);
	}
	view.wrist.position.copy(view.smoothed[0]);
	updatePalm(view);
};
