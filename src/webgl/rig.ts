import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { MODEL_URL } from "./constants";
import { scene } from "./core";
import { type HandView, hands } from "./handView";
import { addOutline, applyToonMaterial } from "./material";

interface RigSegment {
	bone: THREE.Bone;
	restQuat: THREE.Quaternion;
	restDir: THREE.Vector3;
	lmA: number;
	lmB: number;
}

interface RigChain {
	// rootボーン基準での、チェーン基部の親までの静的な回転オフセット
	parentQuat: THREE.Quaternion;
	segs: RigSegment[];
}

interface HandRig {
	wrapper: THREE.Group;
	group: THREE.Group;
	restBasisInv: THREE.Matrix4;
	chains: RigChain[];
	restSpan: number;
	rootRestQuatInv: THREE.Quaternion;
	rootOffset: THREE.Vector3;
	mirrored: boolean;
}

// [0] = 元リグ, [1] = 鏡像クローン(もう一方の手用)
export const handRigs: Array<HandRig | null> = [null, null];

export const isRigActive = () => handRigs[0] !== null;

const isBone = (o: THREE.Object3D): o is THREE.Bone => (o as THREE.Bone).isBone;

// Rigifyエクスポート: DEF-ボーンを名前で拾う(5本指対応)
const findRigifyChains = (
	bones: THREE.Bone[],
): {
	rootBone: THREE.Bone;
	chainBones: THREE.Bone[][];
	lmChains: number[][];
} | null => {
	const rootBone = bones.find((b) => b.name.startsWith("DEF-hand"));
	if (!rootBone) return null;
	const prefixes = [
		"DEF-thumb",
		"DEF-f_index",
		"DEF-f_middle",
		"DEF-f_ring",
		"DEF-f_pinky",
	];
	const lmAll = [
		[1, 2, 3, 4],
		[5, 6, 7, 8],
		[9, 10, 11, 12],
		[13, 14, 15, 16],
		[17, 18, 19, 20],
	];
	const chainBones: THREE.Bone[][] = [];
	const lmChains: number[][] = [];
	for (let i = 0; i < prefixes.length; i++) {
		const list = bones
			.filter((b) => b.name.startsWith(prefixes[i]))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (list.length >= 3) {
			chainBones.push(list.slice(0, 3));
			lmChains.push(lmAll[i]);
		}
	}
	if (chainBones.length < 4) return null;
	return { rootBone, chainBones, lmChains };
};

// 汎用: rootJoint直下に指チェーンが並ぶリグ(glove_hands.glb など)
const findGenericChains = (
	bones: THREE.Bone[],
): {
	rootBone: THREE.Bone;
	chainBones: THREE.Bone[][];
	lmChains: number[][];
} | null => {
	const rootBone = bones.find((b) => !isBone(b.parent as THREE.Object3D));
	if (!rootBone) return null;
	const chainBases = rootBone.children.filter(
		(c): c is THREE.Bone => isBone(c) && c.children.length > 0,
	);
	if (chainBases.length < 4) return null;

	// 手首(原点)に最も近いチェーンが親指
	let thumb = chainBases[0];
	for (const c of chainBases) {
		if (c.position.length() < thumb.position.length()) thumb = c;
	}
	const others = chainBases.filter((c) => c !== thumb);

	// 指の付け根が並ぶ軸(分散最大)を検出し、親指に近い側から index → ring に並べる
	const axes = ["x", "y", "z"] as const;
	let spreadAxis: (typeof axes)[number] = "x";
	let bestVariance = -1;
	for (const ax of axes) {
		const vals = others.map((c) => c.position[ax]);
		const mean = vals.reduce((sum, v) => sum + v, 0) / vals.length;
		const variance = vals.reduce((sum, v) => sum + (v - mean) ** 2, 0);
		if (variance > bestVariance) {
			bestVariance = variance;
			spreadAxis = ax;
		}
	}
	others.sort((a, b) => a.position[spreadAxis] - b.position[spreadAxis]);
	if (
		Math.abs(
			others[others.length - 1].position[spreadAxis] -
				thumb.position[spreadAxis],
		) < Math.abs(others[0].position[spreadAxis] - thumb.position[spreadAxis])
	) {
		others.reverse();
	}

	// 4本指リグなので小指(17-20)はスキップ
	const lmChains = [
		[1, 2, 3, 4],
		[5, 6, 7, 8],
		[9, 10, 11, 12],
		[13, 14, 15, 16],
	];
	const chainBones = [thumb, others[0], others[1], others[2]].map((base) => {
		const cb: THREE.Bone[] = [base];
		let b: THREE.Bone = base;
		while (cb.length < 3) {
			const c = b.children.find(isBone);
			if (!c) break;
			cb.push(c);
			b = c;
		}
		return cb;
	});
	return { rootBone, chainBones, lmChains };
};

const buildRig = (root: THREE.Object3D, mirrored: boolean): HandRig | null => {
	const skinnedMeshes: THREE.SkinnedMesh[] = [];
	root.traverse((o) => {
		if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
			skinnedMeshes.push(o as THREE.SkinnedMesh);
		}
	});
	if (skinnedMeshes.length === 0) return null;

	// 同じ骨格を共有するメッシュ(肌+袖など)は全て使い、別骨格(ミラーコピー等)は隠す
	const mesh = skinnedMeshes[0];
	const usedMeshes = skinnedMeshes.filter(
		(m) => m.skeleton.bones[0] === mesh.skeleton.bones[0],
	);
	// 非表示化はアウトライン追加より先に行う(アウトラインもメッシュの子になるため)
	root.traverse((o) => {
		if (
			(o as THREE.Mesh).isMesh &&
			!usedMeshes.includes(o as THREE.SkinnedMesh)
		) {
			o.visible = false;
		}
	});
	for (const m of usedMeshes) {
		m.frustumCulled = false;
		applyToonMaterial(m);
		addOutline(m);
	}

	const bones = mesh.skeleton.bones;
	const found = findRigifyChains(bones) ?? findGenericChains(bones);
	if (!found) return null;
	const { rootBone, chainBones, lmChains } = found;

	// 非一様スケールの親があると回転が歪むので均一化する
	let anc: THREE.Object3D | null = rootBone.parent;
	while (anc) {
		const s = anc.scale;
		const avg = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3;
		anc.scale.setScalar(avg);
		anc = anc === root ? null : anc.parent;
	}

	const chains: RigChain[] = chainBones.map((cb, ci) => {
		const lms = lmChains[ci];
		const parentQuat = new THREE.Quaternion();
		const stack: THREE.Object3D[] = [];
		let a: THREE.Object3D | null = cb[0].parent;
		while (a && a !== rootBone) {
			stack.push(a);
			a = a.parent;
		}
		for (let i = stack.length - 1; i >= 0; i--) {
			parentQuat.multiply(stack[i].quaternion);
		}
		const segs = cb.map((bone, i) => {
			const child: THREE.Bone | undefined =
				i + 1 < cb.length ? cb[i + 1] : bone.children.find(isBone);
			const restQuat = bone.quaternion.clone();
			const restDir = (
				child ? child.position.clone() : new THREE.Vector3(0, 1, 0)
			)
				.applyQuaternion(restQuat)
				.normalize();
			return { bone, restQuat, restDir, lmA: lms[i], lmB: lms[i + 1] };
		});
		return { parentQuat, segs };
	});

	// ミラーは wrapper の scale.x = -1 で行い、リターゲット計算はミラー前空間で行う
	const group = new THREE.Group();
	group.add(root);
	const wrapper = new THREE.Group();
	wrapper.add(group);
	wrapper.visible = false;
	scene.add(wrapper);

	group.updateMatrixWorld(true);
	const wpRoot = rootBone.getWorldPosition(new THREE.Vector3());
	const wpIndex = chainBones[1][0].getWorldPosition(new THREE.Vector3());
	const wpMid = chainBones[2][0].getWorldPosition(new THREE.Vector3());
	const wpLast = chainBones[chainBones.length - 1][0].getWorldPosition(
		new THREE.Vector3(),
	);
	const restSpan = wpRoot.distanceTo(wpMid);
	if (restSpan < 0.0001) {
		scene.remove(wrapper);
		return null;
	}

	// レストポーズの手のひら基底をrootボーンのローカル系で: X=小指方向, Y=手首→中指, Z=法線
	const qRootRestInv = rootBone
		.getWorldQuaternion(new THREE.Quaternion())
		.invert();
	const mX = wpLast
		.clone()
		.sub(wpIndex)
		.applyQuaternion(qRootRestInv)
		.normalize();
	const mYraw = wpMid
		.clone()
		.sub(wpRoot)
		.applyQuaternion(qRootRestInv)
		.normalize();
	const mZ = new THREE.Vector3().crossVectors(mX, mYraw).normalize();
	const mY = new THREE.Vector3().crossVectors(mZ, mX).normalize();
	const restBasisInv = new THREE.Matrix4().makeBasis(mX, mY, mZ).invert();

	const rootOffset = wpRoot.clone();

	if (mirrored) wrapper.scale.x = -1;

	return {
		wrapper,
		group,
		restBasisInv,
		chains,
		restSpan,
		rootRestQuatInv: qRootRestInv,
		rootOffset,
		mirrored,
	};
};

export const loadRigModel = () => {
	new GLTFLoader().load(MODEL_URL, (gltf) => {
		const cloned = cloneSkeleton(gltf.scene);
		handRigs[0] = buildRig(gltf.scene, false);
		handRigs[1] = buildRig(cloned, true);
		if (!handRigs[0]) {
			console.warn(`${MODEL_URL} のリグを解析できませんでした`);
		}
	});
};

const rigBX = new THREE.Vector3();
const rigBY = new THREE.Vector3();
const rigBZ = new THREE.Vector3();
const rigBasis = new THREE.Matrix4();
const rigWorldQuat = new THREE.Quaternion();
const rigCurQuat = new THREE.Quaternion();
const rigInvQuat = new THREE.Quaternion();
const rigDelta = new THREE.Quaternion();
const segDir = new THREE.Vector3();
const rigWp = new THREE.Vector3();
const mirroredPoints = Array.from({ length: 21 }, () => new THREE.Vector3());

const updateRig = (rig: HandRig, view: HandView) => {
	let p: THREE.Vector3[] = view.smoothed;
	if (rig.mirrored) {
		for (let i = 0; i < 21; i++) {
			mirroredPoints[i].set(-p[i].x, p[i].y, p[i].z);
		}
		p = mirroredPoints;
	}

	// 手のひら基底を合わせて向きを決める。手首ボーンではなくモデル全体を回すことで
	// 前腕ウェイト部分が捻れるのを防ぐ(腕は手と一体で剛体的に回る)
	rigBX.subVectors(p[17], p[5]).normalize();
	rigBY.subVectors(p[9], p[0]);
	rigBZ.crossVectors(rigBX, rigBY).normalize();
	rigBY.crossVectors(rigBZ, rigBX);
	rigBasis.makeBasis(rigBX, rigBY, rigBZ);
	rigBasis.multiply(rig.restBasisInv);
	rigWorldQuat.setFromRotationMatrix(rigBasis);

	rig.group.quaternion.copy(rigWorldQuat).multiply(rig.rootRestQuatInv);

	// 手の大きさに合わせてスケールし、手首位置を合わせる(ミラー前空間)
	const scaleFactor = p[0].distanceTo(p[9]) / rig.restSpan;
	const s = rig.group.scale.x + (scaleFactor - rig.group.scale.x) * 0.3;
	rig.group.scale.setScalar(s);
	rigWp
		.copy(rig.rootOffset)
		.multiplyScalar(s)
		.applyQuaternion(rig.group.quaternion)
		.add(rig.group.position);
	rig.group.position.add(segDir.subVectors(p[0], rigWp));

	// 各指: 親ボーンのワールド回転を辿りながら、レスト方向→目標方向の回転を local に適用
	for (const chain of rig.chains) {
		rigCurQuat.copy(rigWorldQuat).multiply(chain.parentQuat);
		for (const seg of chain.segs) {
			segDir.subVectors(p[seg.lmB], p[seg.lmA]).normalize();
			rigInvQuat.copy(rigCurQuat).invert();
			segDir.applyQuaternion(rigInvQuat);
			rigDelta.setFromUnitVectors(seg.restDir, segDir);
			seg.bone.quaternion.copy(rigDelta).multiply(seg.restQuat);
			rigCurQuat.multiply(seg.bone.quaternion);
		}
	}
};

// 毎フレーム: handedness でリグを選び、検出中の手だけリグを表示する
export const updateHandDisplay = () => {
	if (!isRigActive()) return;
	const rigUsed = [false, false];
	for (const h of hands) {
		if (!h.detected) continue;
		// handedness でリグを選ぶ(埋まっていたらもう片方にフォールバック)
		let idx = h.label === "Right" ? 1 : 0;
		if (rigUsed[idx] || !handRigs[idx]) idx = 1 - idx;
		const rig = handRigs[idx];
		if (!rig || rigUsed[idx]) continue;
		rigUsed[idx] = true;
		rig.wrapper.visible = true;
		updateRig(rig, h);
	}
	for (let i = 0; i < handRigs.length; i++) {
		const rig = handRigs[i];
		if (rig && !rigUsed[i]) rig.wrapper.visible = false;
	}
};
