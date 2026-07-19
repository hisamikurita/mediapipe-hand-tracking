import * as THREE from "three";

export interface HandView {
	smoothed: THREE.Vector3[];
	smoothingInitialized: boolean;
	detected: boolean;
	label: string;
}

const createHandView = (): HandView => ({
	smoothed: Array.from({ length: 21 }, () => new THREE.Vector3()),
	smoothingInitialized: false,
	detected: false,
	label: "",
});

export const hands: HandView[] = [createHandView(), createHandView()];
