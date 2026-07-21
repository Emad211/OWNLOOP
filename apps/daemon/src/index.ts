import { APP_NAME } from "@ownloop/contracts";

export * from "./ingress/index.js";
export * from "./persistence/index.js";
export * from "./lifecycle/index.js";
export * from "./normalization/index.js";

console.log(`${APP_NAME} daemon bootstrap started.`);
