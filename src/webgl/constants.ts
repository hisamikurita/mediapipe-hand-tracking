import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(CustomEase);

// Animation
export const DURATION = {
	SHORT: 0.6,
	BASE: 1.0,
	LONG: 1.2,
	EXTRA_LONG: 2.0,
} as const;

export const EASING = {
	TRANSFORM: CustomEase.create("transform", "M0,0 C0.44,0.05 0.17,1 1,1"),
	MATERIAL: CustomEase.create("material", "M0,0 C0.26,0.16 0.1,1 1,1"),
} as const;
