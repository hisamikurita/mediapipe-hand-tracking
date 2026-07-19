import * as CANNON from "cannon-es";
import * as THREE from "three";
import { FINGER_TIPS } from "./constants";
import { hands } from "./handView";
import {
	GROUP_HAND,
	GROUP_TOY,
	physicsWorld,
	updatePlayBounds,
} from "./physics";
import { syncToys, type Toy, toys, wakeAllToys } from "./toys";

// 手そのものの当たり判定: 各ランドマーク+手のひらにキネマティック球を置き、
// 手の移動速度を持たせて衝突時に勢いが伝わるようにする
const HAND_PARK_Y = -100;

interface HandCollider {
	bodies: CANNON.Body[]; // [0..20]=ランドマーク, [21]=手のひら中心
	prevTargets: THREE.Vector3[];
	active: boolean;
}

const createHandCollider = (): HandCollider => {
	const bodies: CANNON.Body[] = [];
	for (let i = 0; i < 22; i++) {
		let r = 0.22;
		if (i === 0) r = 0.34;
		else if (i === 21) r = 0.55;
		else if (FINGER_TIPS.includes(i)) r = 0.26;
		const body = new CANNON.Body({
			type: CANNON.Body.KINEMATIC,
			shape: new CANNON.Sphere(r),
			collisionFilterGroup: GROUP_HAND,
			collisionFilterMask: GROUP_TOY,
		});
		body.position.set(0, HAND_PARK_Y, 0);
		physicsWorld.addBody(body);
		bodies.push(body);
	}
	return {
		bodies,
		prevTargets: Array.from({ length: 22 }, () => new THREE.Vector3()),
		active: false,
	};
};

const handColliders = [createHandCollider(), createHandCollider()];
const palmCenter = new THREE.Vector3();

const updateHandColliders = (dt: number) => {
	for (let i = 0; i < hands.length; i++) {
		const h = hands[i];
		const hc = handColliders[i];
		if (!h.detected) {
			if (hc.active) {
				for (const b of hc.bodies) {
					b.position.set(0, HAND_PARK_Y, 0);
					b.velocity.setZero();
				}
				hc.active = false;
			}
			continue;
		}
		palmCenter
			.copy(h.smoothed[0])
			.add(h.smoothed[5])
			.add(h.smoothed[9])
			.add(h.smoothed[13])
			.add(h.smoothed[17])
			.multiplyScalar(1 / 5);
		for (let j = 0; j < hc.bodies.length; j++) {
			const b = hc.bodies[j];
			const target = j < 21 ? h.smoothed[j] : palmCenter;
			const prev = hc.prevTargets[j];
			if (hc.active && dt > 0) {
				b.velocity.set(
					(target.x - prev.x) / dt,
					(target.y - prev.y) / dt,
					(target.z - prev.z) / dt,
				);
				const speed = b.velocity.length();
				if (speed > 30) b.velocity.scale(30 / speed, b.velocity);
			} else {
				b.velocity.setZero();
			}
			b.position.set(target.x, target.y, target.z);
			prev.copy(target);
		}
		hc.active = true;
	}
};

// 掴み: ピンチ(親指+人差し指)と握り込み(半グー)の2系統。ヒステリシス付き
const grabbedToys: Array<Toy | null> = [null, null];
const pinchPoint = new THREE.Vector3();
const grabPalmCenter = new THREE.Vector3();

// 掴んでいる間はその物体と手コライダーの衝突を切ってジッターを防ぐ
const holdToy = (i: number, toy: Toy) => {
	grabbedToys[i] = toy;
	toy.body.collisionFilterMask = ~GROUP_HAND;
};

const releaseHeld = (i: number) => {
	const toy = grabbedToys[i];
	if (toy) toy.body.collisionFilterMask = -1;
	grabbedToys[i] = null;
};

// 握り込みのしきい値: 大きい物ほど指が開いたままでも掴めるようにする
// (完全なグーを要求しない。物体の半径ぶんだけ指が閉じきらない前提)
const graspThreshold = (radius: number, span: number) => {
	return Math.min(Math.max(0.45 + (0.5 * radius) / span, 0.5), 0.9);
};

// z軸は距離を甘めに評価して掴みやすくする(表面までの距離を返す)
const surfaceDistance = (from: THREE.Vector3, t: Toy) => {
	const dx = from.x - t.mesh.position.x;
	const dy = from.y - t.mesh.position.y;
	const dz = (from.z - t.mesh.position.z) * 0.5;
	return Math.sqrt(dx * dx + dy * dy + dz * dz) - t.radius;
};

const updateGrab = () => {
	for (let i = 0; i < hands.length; i++) {
		const h = hands[i];
		if (!h.detected) {
			releaseHeld(i);
			continue;
		}
		const span = Math.max(h.smoothed[0].distanceTo(h.smoothed[9]), 0.001);
		const pinchRatio = h.smoothed[4].distanceTo(h.smoothed[8]) / span;
		pinchPoint.copy(h.smoothed[4]).add(h.smoothed[8]).multiplyScalar(0.5);
		grabPalmCenter
			.copy(h.smoothed[0])
			.add(h.smoothed[5])
			.add(h.smoothed[9])
			.add(h.smoothed[13])
			.add(h.smoothed[17])
			.multiplyScalar(1 / 5);
		// 指の曲げ具合: 4本の指先と手のひら中心の距離(手の大きさで正規化)
		// 開いた手 ≈ 1.0, 完全なグー ≈ 0.4
		let curl = 0;
		for (const tip of [8, 12, 16, 20]) {
			curl += h.smoothed[tip].distanceTo(grabPalmCenter);
		}
		const curlRatio = curl / 4 / span;

		const held = grabbedToys[i];
		if (held) {
			// ピンチも握りも開いたときだけ離す(離した瞬間の速度で投げられる)
			const releaseCurl = graspThreshold(held.radius, span) + 0.2;
			if (pinchRatio > 0.5 && curlRatio > releaseCurl) {
				releaseHeld(i);
				continue;
			}
			const target = pinchRatio < 0.45 ? pinchPoint : grabPalmCenter;
			const body = held.body;
			body.wakeUp();
			body.velocity.set(
				(target.x - body.position.x) * 18,
				(target.y - body.position.y) * 18,
				(target.z - body.position.z) * 18,
			);
			const speed = body.velocity.length();
			if (speed > 28) body.velocity.scale(28 / speed, body.velocity);
			body.angularVelocity.scale(0.85, body.angularVelocity);
		} else {
			const pinchClosed = pinchRatio < 0.32;
			let best: Toy | null = null;
			let bestScore = Number.POSITIVE_INFINITY;
			for (const t of toys) {
				if (grabbedToys.includes(t)) continue;
				const dPinch = surfaceDistance(pinchPoint, t);
				const dPalm = surfaceDistance(grabPalmCenter, t);
				const canPinch = pinchClosed && dPinch < 1.05;
				const canGrasp =
					curlRatio < graspThreshold(t.radius, span) && dPalm < 0.7;
				if (!canPinch && !canGrasp) continue;
				const score = Math.min(
					canPinch ? dPinch : Number.POSITIVE_INFINITY,
					canGrasp ? dPalm : Number.POSITIVE_INFINITY,
				);
				if (score < bestScore) {
					bestScore = score;
					best = t;
				}
			}
			if (best) holdToy(i, best);
		}
	}
};

let lastPhysicsTime = performance.now();

export const updatePhysics = () => {
	const now = performance.now();
	const dt = Math.min((now - lastPhysicsTime) / 1000, 0.05);
	lastPhysicsTime = now;
	// 壁が動いたら休止中のオブジェクトも起こして押し戻されるようにする
	if (updatePlayBounds()) wakeAllToys();
	updateGrab();
	updateHandColliders(dt);
	physicsWorld.step(1 / 60, dt, 3);
	syncToys(dt);
};
