import * as THREE from "three";
import { BACKGROUND_COLOR, CAMERA, FOG } from "./constants";

export const canvas = document.getElementById("stage") as HTMLCanvasElement;

export const renderer = new THREE.WebGLRenderer({
	canvas,
	antialias: true,
	alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(BACKGROUND_COLOR);
scene.fog = new THREE.Fog(BACKGROUND_COLOR, FOG.NEAR, FOG.FAR);

export const camera = new THREE.PerspectiveCamera(
	CAMERA.FOV,
	window.innerWidth / window.innerHeight,
	CAMERA.NEAR,
	CAMERA.FAR,
);
camera.position.set(0, 0, CAMERA.INITIAL_Z);
camera.lookAt(0, 0, 0);

export const handleResize = (): void => {
	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});
};

export const startAnimationLoop = (update: () => void): void => {
	const tick = () => {
		update();
		renderer.render(scene, camera);
		requestAnimationFrame(tick);
	};
	tick();
};
