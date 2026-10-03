import type { ResourceDefinition } from "../../resources/definition.js";

export const transfers: ResourceDefinition = {
  "command": "transfers",
  "description": "Core Transfers — money movement in either direction",
  "columns": [
    "id",
    "status",
    "payment_status",
    "failure_code",
    "amount.value",
    "amount.currency",
    "amount_refunded.value"
  ],
  "operations": [
    {
      "verb": "list",
      "method": "GET",
      "path": "/v2/transfers",
      "summary": "List Core Transfers",
      "pathParams": [],
      "flags": [
        {
          "flag": "limit",
          "location": "query",
          "path": [
            "limit"
          ],
          "type": "integer",
          "description": "Maximum number of transfers to return (1-100)"
        },
        {
          "flag": "page",
          "location": "query",
          "path": [
            "page"
          ],
          "type": "integer",
          "description": "Page number to return, starting at 1"
        },
        {
          "flag": "type",
          "location": "query",
          "path": [
            "type"
          ],
          "type": "string",
          "description": "Only return transfers of this type",
          "choices": [
            "payment",
            "payout"
          ]
        },
        {
          "flag": "status",
          "location": "query",
          "path": [
            "status"
          ],
          "type": "string",
          "description": "Only return transfers with this status"
        },
        {
          "flag": "account",
          "location": "query",
          "path": [
            "account"
          ],
          "type": "string",
          "description": "Only return transfers involving this Account id"
        }
      ],
      "acceptsBody": false
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v2/transfers/{id}",
      "summary": "Retrieve a Core Transfer",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Core Transfer"
        }
      ],
      "flags": [],
      "acceptsBody": false
    }
  ]
};
