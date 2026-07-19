import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

// GitHub Pages 用: サブパス公開 (`/mediapipe-hand-tracking/`) の場合は VITE_BASE=/mediapipe-hand-tracking/ を渡す
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
	root: "src",
	publicDir: "../public",
	base,
	plugins: [glsl()],
	build: {
		outDir: "../dist",
		emptyOutDir: true,
	},
});
