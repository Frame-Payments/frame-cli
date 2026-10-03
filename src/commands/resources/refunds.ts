import type { ResourceDefinition } from "../../resources/definition.js";

export const refunds: ResourceDefinition = {
  "command": "refunds",
  "description": "Refunds — reversals of completed inbound Core Transfers",
  "columns": [
    "id",
    "status",
    "amount",
    "currency",
    "transfer_id",
    "reason"
  ],
  "operations": [
    {
      "verb": "create",
      "method": "POST",
      "path": "/v1/refunds",
      "summary": "Refund a completed inbound Core Transfer",
      "pathParams": [],
      "flags": [
        {
          "flag": "transfer",
          "location": "body",
          "path": [
            "transfer"
          ],
          "type": "string",
          "description": "Id of the completed inbound Core Transfer to refund"
        },
        {
          "flag": "amount",
          "location": "body",
          "path": [
            "amount"
          ],
          "type": "integer",
          "description": "Amount to refund in the smallest currency unit; defaults to the full amount"
        },
        {
          "flag": "reason",
          "location": "body",
          "path": [
            "reason"
          ],
          "type": "string",
          "description": "Why the transfer is being refunded",
          "choices": [
            "duplicate",
            "fraudulent",
            "requested_by_customer",
            "expired_uncaptured_charge"
          ]
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v1/refunds/{id}",
      "summary": "Retrieve a Refund",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Refund"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list",
      "method": "GET",
      "path": "/v1/refunds",
      "summary": "List Refunds",
      "pathParams": [],
      "flags": [
        {
          "flag": "transfer",
          "location": "query",
          "path": [
            "transfer"
          ],
          "type": "string",
          "description": "Only return refunds of this Core Transfer id"
        },
        {
          "flag": "limit",
          "location": "query",
          "path": [
            "limit"
          ],
          "type": "integer",
          "description": "Maximum number of refunds to return (1-100)"
        },
        {
          "flag": "page",
          "location": "query",
          "path": [
            "page"
          ],
          "type": "integer",
          "description": "Page number to return, starting at 1"
        }
      ],
      "acceptsBody": false
    }
  ]
};
