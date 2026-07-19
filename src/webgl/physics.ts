import * as CANNON from "cannon-es";
import { FLOOR_Y, Z_BACK_LIMIT, Z_FRONT_LIMIT } from "./constants";
import { camera } from "./core";

export const physicsWorld = new CANNON.World({
	gravity: new CANNON.Vec3(0, -18, 0),
});
physicsWorld.allowSleep = true;
physicsWorld.defaultContactMaterial.friction = 0.35;
physicsWorld.defaultContactMaterial.restitution = 0.45;

// 衝突グループ: 手コライダーはおもちゃとだけ衝突させる
export const GROUP_TOY = 1;
export const GROUP_HAND = 2;
const GROUP_STATIC = 4;

// 床 + 見えない壁で遊び場を囲う
const addStaticPlane = (
	pos: [number, number, number],
	euler: [number, number, number],
): CANNON.Body => {
	const body = new CANNON.Body({
		type: CANNON.Body.STATIC,
		shape: new CANNON.Plane(),
		collisionFilterGroup: GROUP_STATIC,
	});
	body.quaternion.setFromEuler(euler[0], euler[1], euler[2]);
	body.position.set(pos[0], pos[1], pos[2]);
	physicsWorld.addBody(body);
	return body;
};
addStaticPlane([0, FLOOR_Y, 0], [-Math.PI / 2, 0, 0]);
const leftWallBody = addStaticPlane([-10, 0, 0], [0, Math.PI / 2, 0]);
const rightWallBody = addStaticPlane([10, 0, 0], [0, -Math.PI / 2, 0]);
const ceilingBody = addStaticPlane([0, 20, 0], [Math.PI / 2, 0, 0]);
addStaticPlane([0, 0, -Z_BACK_LIMIT], [0, 0, 0]);
addStaticPlane([0, 0, Z_FRONT_LIMIT], [0, Math.PI, 0]);

// 側面の壁と天井を画面の見えている範囲に合わせる(リサイズに追従)
// 壁が動いたら true を返し、呼び出し側で休止中のオブジェクトを起こす
let lastBoundsHalfW = 0;
export const updatePlayBounds = (): boolean => {
	const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
	const halfW = halfH * camera.aspect;
	leftWallBody.position.x = -Math.max(halfW - 0.6, 2);
	rightWallBody.position.x = Math.max(halfW - 0.6, 2);
	ceilingBody.position.y = Math.max(halfH - 0.3, 1);
	if (Math.abs(halfW - lastBoundsHalfW) > 0.01) {
		lastBoundsHalfW = halfW;
		return true;
	}
	return false;
};
