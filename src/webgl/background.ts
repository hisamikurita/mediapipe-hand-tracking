import * as THREE from "three";
import { FLOOR_COLOR, SHADING_PARAMS } from "./constants";
import { scene } from "./core";
import { toonGradientMap } from "./material";

export const shadowCatcher = new THREE.Mesh(
	new THREE.PlaneGeometry(40, 40),
	new THREE.ShadowMaterial({ opacity: SHADING_PARAMS.shadowOpacity }),
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.position.y = -4;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

// スタジオ風の円形床: 単色背景の中に浮かぶステージ
const floorMesh = new THREE.Mesh(
	new THREE.CircleGeometry(20, 64),
	new THREE.MeshToonMaterial({
		color: FLOOR_COLOR,
		gradientMap: toonGradientMap,
	}),
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.position.y = -4.02;
scene.add(floorMesh);
