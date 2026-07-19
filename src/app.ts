import { initHandTracking, updateHand } from "./app/handTracking";
import { setStatus } from "./app/status";
import {
	handleResize,
	loadRigModel,
	startAnimationLoop,
	updateHandDisplay,
	updatePhysics,
} from "./webgl";

loadRigModel();
handleResize();

initHandTracking().catch((err) => {
	console.error(err);
	setStatus("Failed to start the camera");
});

startAnimationLoop(() => {
	updateHand();
	updateHandDisplay();
	updatePhysics();
});
