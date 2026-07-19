import * as THREE from "three";
import { SHADING_PARAMS } from "./constants";
import { scene } from "./core";

export const keyLight = new THREE.DirectionalLight(
	"#ffffff",
	SHADING_PARAMS.keyLight,
);
keyLight.position.set(4, 6, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -8;
keyLight.shadow.camera.right = 8;
keyLight.shadow.camera.top = 8;
keyLight.shadow.camera.bottom = -8;
scene.add(keyLight);

export const rimLight = new THREE.DirectionalLight(
	"#8ab6ff",
	SHADING_PARAMS.rimLight,
);
rimLight.position.set(-6, 2, -4);
scene.add(rimLight);

export const ambientLight = new THREE.AmbientLight(
	"#ffffff",
	SHADING_PARAMS.ambient,
);
scene.add(ambientLight);
