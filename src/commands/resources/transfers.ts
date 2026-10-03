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
    },
    {
      "verb": "create",
      "method": "POST",
      "path": "/v2/transfers",
      "summary": "Create a Core Transfer",
      "pathParams": [],
      "flags": [
        {
          "flag": "amount.value",
          "location": "body",
          "path": [
            "amount",
            "value"
          ],
          "type": "integer",
          "description": "Amount in the smallest currency unit"
        },
        {
          "flag": "amount.currency",
          "location": "body",
          "path": [
            "amount",
            "currency"
          ],
          "type": "string",
          "description": "Three-letter ISO currency code",
          "choices": [
            "usd"
          ]
        },
        {
          "flag": "source.payment_method_id",
          "location": "body",
          "path": [
            "source",
            "payment_method_id"
          ],
          "type": "string",
          "description": "PaymentMethod the funds are pulled from"
        },
        {
          "flag": "destination.account_id",
          "location": "body",
          "path": [
            "destination",
            "account_id"
          ],
          "type": "string",
          "description": "Account the funds are paid out to"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Free-text description shown to the merchant"
        },
        {
          "flag": "confirm",
          "location": "body",
          "path": [
            "confirm"
          ],
          "type": "boolean",
          "description": "Confirm the transfer immediately instead of leaving it for frame transfers confirm"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "confirm",
      "method": "POST",
      "path": "/v2/transfers/{id}/confirm",
      "summary": "Confirm a Core Transfer so it starts moving money",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Core Transfer"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "refund",
      "method": "POST",
      "path": "/v2/transfers/{id}/refund",
      "summary": "Refund a completed inbound Core Transfer",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Core Transfer"
        }
      ],
      "flags": [
        {
          "flag": "amount.value",
          "location": "body",
          "path": [
            "amount",
            "value"
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
          "description": "Why the transfer is being refunded"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "capture",
      "method": "POST",
      "path": "/v2/transfers/{id}/capture",
      "summary": "Capture an authorized Core Transfer",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Core Transfer"
        }
      ],
      "flags": [
        {
          "flag": "amount.value",
          "location": "body",
          "path": [
            "amount",
            "value"
          ],
          "type": "integer",
          "description": "Amount to capture in the smallest currency unit; defaults to the authorized amount"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "void",
      "method": "POST",
      "path": "/v2/transfers/{id}/void",
      "summary": "Void an authorized Core Transfer before capture",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Core Transfer"
        }
      ],
      "flags": [],
      "acceptsBody": false
    }
  ],
  "wait": {
    "terminalStatuses": [
      "completed",
      "failed",
      "reversed",
      "canceled"
    ],
    "verbs": [
      "create",
      "confirm"
    ]
  }
};
