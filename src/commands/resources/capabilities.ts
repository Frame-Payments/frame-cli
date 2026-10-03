import type { ResourceDefinition } from "../../resources/definition.js";

export const capabilities: ResourceDefinition = {
  "command": "capabilities",
  "description": "Capabilities — permissions an Account requests",
  "columns": [
    "name",
    "status",
    "disabled_reason"
  ],
  "operations": [
    {
      "verb": "request",
      "method": "POST",
      "path": "/v1/accounts/{account_id}/capabilities",
      "summary": "Request Capabilities for an Account",
      "pathParams": [
        {
          "name": "account_id",
          "description": "Id of the Account requesting the capabilities"
        }
      ],
      "bodyArgument": {
        "name": "capabilities",
        "description": "Capabilities to request for the Account",
        "choices": [
          "card_receive",
          "card_send",
          "bank_account_receive",
          "bank_account_send",
          "kyc",
          "kyc_prefill"
        ]
      },
      "flags": [],
      "acceptsBody": true
    }
  ]
};
