import { bootstrapApp } from "./app.js";
import { initTutorController, updateTutorLabels } from "./ui/tutorController.js";

const { world } = bootstrapApp();

// Initialize tutor system
initTutorController(world);

// Add label rendering to the animation loop
function tutorRenderLoop() {
  updateTutorLabels();
  requestAnimationFrame(tutorRenderLoop);
}
requestAnimationFrame(tutorRenderLoop);
