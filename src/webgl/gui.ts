import GUI from "lil-gui";
import { params } from "./voronoi";

export const setupGui = () => {
	const gui = new GUI({ title: "Voronoi" });
	gui.add(params, "density", 1, 30, 0.5).name("density");
	gui.add(params, "animSpeed", 0, 2, 0.01).name("anim speed");
	gui.add(params, "edgeWidth", 0.0, 0.3, 0.005).name("edge width");
	gui.add(params, "centerZoom", 1.0, 5.0, 0.05).name("center zoom");
	gui.add(params, "showPoints").name("show seed points");

	const images = gui.addFolder("images");
	images.add(params, "showImages").name("show images");
	images.add(params, "imageScale", 0.3, 2.5, 0.05).name("image scale");
	images.add(params, "parallax", -6.0, 6.0, 0.1).name("parallax");

	const colors = gui.addFolder("fallback colors").close();
	colors.addColor(params, "colorA").name("color A");
	colors.addColor(params, "colorB").name("color B");
	colors.addColor(params, "edgeColor").name("edge color");
};
