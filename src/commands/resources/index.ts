import type { DeprecatedResource, ResourceDefinition } from "../../resources/definition.js";
import { transfers } from "./transfers.js";

export const resources: ResourceDefinition[] = [transfers];

export const deprecatedResources: DeprecatedResource[] = [
  {
    "command": "customers",
    "canonical": "accounts"
  },
  {
    "command": "charge-intents",
    "canonical": "transfers"
  },
  {
    "command": "payouts",
    "canonical": "transfers"
  }
];
