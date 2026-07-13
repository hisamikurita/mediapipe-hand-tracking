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

// 5x4 = 20 スロットに 20 枚。無駄なくパックできて hash 分布も均等
const ATLAS_COLS = 5;
const ATLAS_ROWS = 4;
const IMAGE_SIZE = 512;

const buildUrl = (id: string) =>
	`https://images.unsplash.com/${id}?w=${IMAGE_SIZE}&q=80&auto=format&fit=crop`;

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
	new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
	});

// 画像をアトラスセル (dw x dh) に background: cover 相当で描画
const drawCover = (
	ctx: CanvasRenderingContext2D,
	img: HTMLImageElement,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
) => {
	const iw = img.naturalWidth;
	const ih = img.naturalHeight;
	const imgRatio = iw / ih;
	const dstRatio = dw / dh;
	let sx: number;
	let sy: number;
	let sw: number;
	let sh: number;
	if (imgRatio > dstRatio) {
		// 画像が横長 → 左右をクロップ
		sh = ih;
		sw = ih * dstRatio;
		sx = (iw - sw) / 2;
		sy = 0;
	} else {
		// 画像が縦長 → 上下をクロップ
		sw = iw;
		sh = iw / dstRatio;
		sx = 0;
		sy = (ih - sh) / 2;
	}
	ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
};

export type ImageAtlas = {
	texture: CanvasTexture;
	cols: number;   // アトラスの列数
	rows: number;   // アトラスの行数
	count: number;  // ロードに成功した画像数
};

export const loadImageAtlas = async (): Promise<ImageAtlas | null> => {
	const results = await Promise.all(UNSPLASH_IDS.map((id) => loadImage(buildUrl(id))));
	const images = results.filter((img): img is HTMLImageElement => img !== null);
	if (images.length === 0) {
		console.warn("[images] no images loaded");
		return null;
	}
	if (images.length < UNSPLASH_IDS.length) {
		console.warn(
			`[images] loaded ${images.length}/${UNSPLASH_IDS.length} — some URLs failed`,
		);
	}

	const canvas = document.createElement("canvas");
	canvas.width = ATLAS_COLS * IMAGE_SIZE;
	canvas.height = ATLAS_ROWS * IMAGE_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

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

	const texture = new CanvasTexture(canvas);
	// アトラスは mipmap を切って隣接タイルの色にじみを防ぐ
	texture.generateMipmaps = false;
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.needsUpdate = true;

	return { texture, cols: ATLAS_COLS, rows: ATLAS_ROWS, count: images.length };
};
