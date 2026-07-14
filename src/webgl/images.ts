import { CanvasTexture, LinearFilter } from "three";

// Unsplash の公開画像 URL。全 ID を HEAD リクエストで存在確認済み。
// もし 404 が出た場合はここを差し替えれば OK (ロード失敗した画像は自動でスキップされる)。
const UNSPLASH_IDS = [
	"photo-1506905925346-21bda4d32df4",
	"photo-1441974231531-c6227db76b6e",
	"photo-1470813740244-df37b8c1edcb",
	"photo-1506744038136-46273834b3fb",
	"photo-1519681393784-d120267933ba",
	"photo-1493246507139-91e8fad9978e",
	"photo-1502082553048-f009c37129b9",
	"photo-1518791841217-8f162f1e1131",
	"photo-1500534314209-a25ddb2bd429",
	"photo-1518756131217-31eb79b20e8f",
	"photo-1447752875215-b2761acb3c5d",
	"photo-1444927714506-8492d94b4e3d",
	"photo-1418065460487-3e41a6c84dc5",
	"photo-1421789665209-c9b2a435e3dc",
	"photo-1500462918059-b1a0cb512f1d",
	"photo-1516035069371-29a1b244cc32",
	"photo-1439066615861-d1af74d74000",
	"photo-1465146344425-f00d5f5c8f07",
	"photo-1444464666168-49d633b86797",
	"photo-1505142468610-359e7d316be0",
];

// Pexels の公開動画 URL。全て HEAD で 200 確認済み。
// 差し替える場合は https://www.pexels.com/videos/ で ID を確認し、videos.pexels.com の URL を貼る。
const PEXELS_VIDEO_URLS = [
	"https://videos.pexels.com/video-files/3195394/3195394-sd_640_360_25fps.mp4",
	"https://videos.pexels.com/video-files/1093662/1093662-sd_640_360_30fps.mp4",
	"https://videos.pexels.com/video-files/2519660/2519660-hd_1920_1080_24fps.mp4",
	"https://videos.pexels.com/video-files/2887463/2887463-hd_1920_1080_25fps.mp4",
	"https://videos.pexels.com/video-files/1739010/1739010-hd_1920_1080_30fps.mp4",
];

// 5x5 = 25 スロット。画像 20 + 動画 5 でぴったり
const ATLAS_COLS = 5;
const ATLAS_ROWS = 5;
const IMAGE_SIZE = 512;

const buildImageUrl = (id: string) =>
	`https://images.unsplash.com/${id}?w=${IMAGE_SIZE}&q=80&auto=format&fit=crop`;

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
	new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
	});

const loadVideo = (url: string): Promise<HTMLVideoElement | null> =>
	new Promise((resolve) => {
		const video = document.createElement("video");
		video.crossOrigin = "anonymous";
		video.muted = true;   // autoplay に必須
		video.loop = true;
		video.playsInline = true;
		video.preload = "auto";
		// 一定時間で応答なしなら諦める
		const timeout = setTimeout(() => resolve(null), 15000);
		const onReady = () => {
			clearTimeout(timeout);
			video.removeEventListener("canplay", onReady);
			// play() は autoplay policy で reject される可能性あり (muted なので大抵通る)
			video.play().catch(() => {});
			resolve(video);
		};
		video.addEventListener("canplay", onReady);
		video.addEventListener("error", () => {
			clearTimeout(timeout);
			resolve(null);
		});
		video.src = url;
	});

// 画像/動画をアトラスセル (dw x dh) に background: cover 相当で描画
const drawCover = (
	ctx: CanvasRenderingContext2D,
	src: HTMLImageElement | HTMLVideoElement,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
) => {
	const iw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
	const ih = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
	if (iw === 0 || ih === 0) return; // 動画がまだフレームを持っていない
	const imgRatio = iw / ih;
	const dstRatio = dw / dh;
	let sx: number;
	let sy: number;
	let sw: number;
	let sh: number;
	if (imgRatio > dstRatio) {
		sh = ih;
		sw = ih * dstRatio;
		sx = (iw - sw) / 2;
		sy = 0;
	} else {
		sw = iw;
		sh = iw / dstRatio;
		sx = 0;
		sy = (ih - sh) / 2;
	}
	ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
};

export type ImageAtlas = {
	texture: CanvasTexture;
	cols: number;   // アトラスの列数
	rows: number;   // アトラスの行数
	count: number;  // ロード成功した画像 + 動画の合計
	tick: () => void; // 動画スロットを毎フレーム更新
};

export const loadImageAtlas = async (): Promise<ImageAtlas | null> => {
	const [imageResults, videoResults] = await Promise.all([
		Promise.all(UNSPLASH_IDS.map((id) => loadImage(buildImageUrl(id)))),
		Promise.all(PEXELS_VIDEO_URLS.map(loadVideo)),
	]);
	const images = imageResults.filter((v): v is HTMLImageElement => v !== null);
	const videos = videoResults.filter((v): v is HTMLVideoElement => v !== null);
	if (images.length === 0 && videos.length === 0) {
		console.warn("[atlas] no media loaded");
		return null;
	}
	if (images.length < UNSPLASH_IDS.length) {
		console.warn(
			`[atlas] images ${images.length}/${UNSPLASH_IDS.length} — some URLs failed`,
		);
	}
	if (videos.length < PEXELS_VIDEO_URLS.length) {
		console.warn(
			`[atlas] videos ${videos.length}/${PEXELS_VIDEO_URLS.length} — some URLs failed`,
		);
	}

	const canvas = document.createElement("canvas");
	canvas.width = ATLAS_COLS * IMAGE_SIZE;
	canvas.height = ATLAS_ROWS * IMAGE_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// 画像は一度だけ描画 (静的)
	for (let i = 0; i < images.length; i++) {
		const col = i % ATLAS_COLS;
		const row = Math.floor(i / ATLAS_COLS);
		drawCover(
			ctx,
			images[i],
			col * IMAGE_SIZE,
			row * IMAGE_SIZE,
			IMAGE_SIZE,
			IMAGE_SIZE,
		);
	}

	// 動画スロットの位置を確定 (画像の後ろに続けて配置)
	const videoSlots = videos.map((video, i) => {
		const slotIndex = images.length + i;
		return {
			video,
			x: (slotIndex % ATLAS_COLS) * IMAGE_SIZE,
			y: Math.floor(slotIndex / ATLAS_COLS) * IMAGE_SIZE,
		};
	});

	// 動画も初回描画 (真っ黒スロットを避ける)
	for (const { video, x, y } of videoSlots) {
		drawCover(ctx, video, x, y, IMAGE_SIZE, IMAGE_SIZE);
	}

	const texture = new CanvasTexture(canvas);
	texture.generateMipmaps = false;
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.needsUpdate = true;

	// 毎フレーム動画スロットを更新
	const tick = () => {
		if (videoSlots.length === 0) return;
		let updated = false;
		for (const { video, x, y } of videoSlots) {
			// readyState >= 2 (HAVE_CURRENT_DATA) 以上でフレームが取り出せる
			if (video.readyState >= 2) {
				drawCover(ctx, video, x, y, IMAGE_SIZE, IMAGE_SIZE);
				updated = true;
			}
		}
		if (updated) texture.needsUpdate = true;
	};

	return {
		texture,
		cols: ATLAS_COLS,
		rows: ATLAS_ROWS,
		count: images.length + videos.length,
		tick,
	};
};
