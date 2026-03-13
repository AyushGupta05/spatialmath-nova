import { Hono } from "hono";
import { getCapabilitySnapshot } from "../services/modelRouter.js";

const capabilitiesRoute = new Hono();

capabilitiesRoute.get("/", (c) => c.json(getCapabilitySnapshot()));

export default capabilitiesRoute;
