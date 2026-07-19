import * as CANNON from "cannon-es";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { FLOOR_Y } from "./constants";
import { scene } from "./core";
import { addMeshOutline, toonGradientMap } from "./material";
import { GROUP_TOY, physicsWorld } from "./physics";

export interface Toy {
	mesh: THREE.Mesh;
	body: CANNON.Body;
	// 掴み判定用のおおまかな半径(バウンディングスフィア)
	radius: number;
}
export const toys: Toy[] = [];

type ToyKind = "box" | "sphere" | "cone" | "cylinder" | "torus";

const TOY_DEFAULT_SIZE: Record<ToyKind, number> = {
	box: 1.15,
	sphere: 0.65,
	cone: 0.7,
	cylinder: 0.55,
	torus: 0.55,
};

const registerToy = (
	geometry: THREE.BufferGeometry,
	color: string,
	body: CANNON.Body,
	x: number,
	y: number,
	z: number,
) => {
	const mesh = new THREE.Mesh(
		geometry,
		new THREE.MeshToonMaterial({ color, gradientMap: toonGradientMap }),
	);
	mesh.castShadow = true;
	addMeshOutline(mesh, 0.025);
	scene.add(mesh);
	body.position.set(x, y, z);
	body.angularDamping = 0.2;
	physicsWorld.addBody(body);
	geometry.computeBoundingSphere();
	const radius = geometry.boundingSphere?.radius ?? 0.5;
	toys.push({ mesh, body, radius });
};

const createToy = (
	kind: ToyKind,
	color: string,
	x: number,
	y: number,
	z: number,
	size = TOY_DEFAULT_SIZE[kind],
) => {
	const body = new CANNON.Body({
		mass: 1,
		collisionFilterGroup: GROUP_TOY,
	});
	let geometry: THREE.BufferGeometry;
	switch (kind) {
		case "box":
			geometry = new RoundedBoxGeometry(size, size, size, 4, size * 0.17);
			body.addShape(
				new CANNON.Box(new CANNON.Vec3(size / 2, size / 2, size / 2)),
			);
			break;
		case "sphere":
			geometry = new THREE.SphereGeometry(size, 24, 18);
			body.addShape(new CANNON.Sphere(size));
			break;
		case "cone":
			geometry = new THREE.ConeGeometry(size, size * 1.5, 20);
			body.addShape(new CANNON.Cylinder(0.02, size, size * 1.5, 12));
			break;
		case "cylinder":
			geometry = new THREE.CylinderGeometry(size, size, size * 1.6, 20);
			body.addShape(new CANNON.Cylinder(size, size, size * 1.6, 12));
			break;
		case "torus": {
			// 物理形状はリング状に並べた球で近似する
			const tube = size * 0.45;
			geometry = new THREE.TorusGeometry(size, tube, 14, 24);
			for (let k = 0; k < 8; k++) {
				const a = (k / 8) * Math.PI * 2;
				body.addShape(
					new CANNON.Sphere(tube),
					new CANNON.Vec3(Math.cos(a) * size, Math.sin(a) * size, 0),
				);
			}
			break;
		}
	}
	registerToy(geometry, color, body, x, y, z);
};

// テキストのオブジェクト: 文字ごとではなく単語まるごと1つの剛体にする
const fontLoader = new FontLoader();
fontLoader.load("/fonts/helvetiker_bold.typeface.json", (font) => {
	const createTextToy = (
		text: string,
		color: string,
		x: number,
		y: number,
		z: number,
		size: number,
	) => {
		const geometry = new TextGeometry(text, {
			font,
			size,
			depth: size * 0.4,
			curveSegments: 6,
			bevelEnabled: true,
			bevelThickness: size * 0.06,
			bevelSize: size * 0.04,
			bevelSegments: 2,
		});
		geometry.computeBoundingBox();
		const bb = geometry.boundingBox;
		if (!bb) return;
		// 原点が左下手前なので中心に寄せてから当たり判定の箱を合わせる
		const cx = (bb.min.x + bb.max.x) / 2;
		const cy = (bb.min.y + bb.max.y) / 2;
		const cz = (bb.min.z + bb.max.z) / 2;
		geometry.translate(-cx, -cy, -cz);
		const body = new CANNON.Body({
			mass: 1,
			collisionFilterGroup: GROUP_TOY,
			shape: new CANNON.Box(
				new CANNON.Vec3(
					(bb.max.x - bb.min.x) / 2,
					(bb.max.y - bb.min.y) / 2,
					(bb.max.z - bb.min.z) / 2,
				),
			),
		});
		registerToy(geometry, color, body, x, y, z);
	};

	createTextToy("HELLO", "#ff5252", -3.6, FLOOR_Y + 10, 0.2, 0.75);
	createTextToy("POP!", "#40c4ff", 2.6, FLOOR_Y + 11, -0.5, 0.9);
	createTextToy("YAY", "#ffd740", 5.2, FLOOR_Y + 12, 0.8, 0.8);
	createTextToy("WOW", "#69f0ae", -0.8, FLOOR_Y + 19, -0.6, 0.85);
	createTextToy("FUN", "#ff80ab", -5.8, FLOOR_Y + 20, 0.4, 0.8);
});

createToy("box", "#ff8a5c", -6.4, FLOOR_Y + 3, -1);
createToy("box", "#6ec6ff", -2.8, FLOOR_Y + 5, 0.8);
createToy("box", "#b39ddb", 5.6, FLOOR_Y + 4.5, -1);
createToy("sphere", "#ffd93d", -5.9, FLOOR_Y + 4, 0.6, 0.7);
createToy("sphere", "#7ccf74", -4.2, FLOOR_Y + 3.5, 0.3, 0.8);
createToy("sphere", "#ffffff", -1.4, FLOOR_Y + 7, -1.2, 0.5);
createToy("sphere", "#ffb74d", 0, FLOOR_Y + 8, 0.5, 0.65);
createToy("sphere", "#4dd0e1", 1.6, FLOOR_Y + 6.5, -0.3, 0.75);
createToy("sphere", "#aed581", 4.4, FLOOR_Y + 7.5, -1.3, 0.6);
createToy("cone", "#ff7043", 6.4, FLOOR_Y + 5, -0.8);
createToy("cone", "#4db6ac", -6.1, FLOOR_Y + 7, 0.4, 0.6);
createToy("cone", "#fff176", 2.2, FLOOR_Y + 9, 0.4, 0.8);
createToy("cylinder", "#e57373", -0.6, FLOOR_Y + 4, -1.4);
createToy("cylinder", "#64b5f6", 4.8, FLOOR_Y + 8.5, 0.2, 0.5);
createToy("torus", "#ffd54f", -3.4, FLOOR_Y + 8, -0.9);
createToy("torus", "#81c784", 0.8, FLOOR_Y + 6, 0.6, 0.65);
createToy("box", "#ffcc80", -1.8, FLOOR_Y + 10, -0.4, 0.9);

export const wakeAllToys = () => {
	for (const t of toys) t.body.wakeUp();
};

export const syncToys = (dt: number) => {
	for (const t of toys) {
		// ゆるいバネで z=0 付近へ引き戻し、手が届く奥行きに留める
		t.body.velocity.z -= t.body.position.z * 3 * dt;
		t.mesh.position.set(
			t.body.position.x,
			t.body.position.y,
			t.body.position.z,
		);
		t.mesh.quaternion.set(
			t.body.quaternion.x,
			t.body.quaternion.y,
			t.body.quaternion.z,
			t.body.quaternion.w,
		);
	}
};
