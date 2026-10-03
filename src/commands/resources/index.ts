import type { DeprecatedResource, ResourceDefinition } from "../../resources/definition.js";
import { transfers } from "./transfers.js";
import { paymentMethods } from "./payment-methods.js";
import { accounts } from "./accounts.js";
import { capabilities } from "./capabilities.js";

export const resources: ResourceDefinition[] = [transfers, paymentMethods, accounts, capabilities];

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
