import type { ResourceDefinition } from "../../resources/definition.js";

export const paymentMethods: ResourceDefinition = {
  "command": "payment-methods",
  "description": "PaymentMethods — cards and bank accounts a Transfer moves money from or to",
  "columns": [
    "id",
    "type",
    "status",
    "account_id",
    "ach.account_type",
    "ach.last_four"
  ],
  "operations": [
    {
      "verb": "create",
      "method": "POST",
      "path": "/v1/payment_methods",
      "summary": "Create a PaymentMethod",
      "pathParams": [],
      "flags": [
        {
          "flag": "type",
          "location": "body",
          "path": [
            "type"
          ],
          "type": "string",
          "description": "Kind of payment method",
          "choices": [
            "card",
            "ach"
          ]
        },
        {
          "flag": "account",
          "location": "body",
          "path": [
            "account"
          ],
          "type": "string",
          "description": "Account id to attach the payment method to"
        },
        {
          "flag": "account_number",
          "location": "body",
          "path": [
            "account_number"
          ],
          "type": "string",
          "description": "Bank account number (ach)"
        },
        {
          "flag": "routing_number",
          "location": "body",
          "path": [
            "routing_number"
          ],
          "type": "string",
          "description": "Nine-digit ABA routing number (ach)"
        },
        {
          "flag": "account_type",
          "location": "body",
          "path": [
            "account_type"
          ],
          "type": "string",
          "description": "Bank account type (ach)",
          "choices": [
            "checking",
            "savings"
          ]
        },
        {
          "flag": "card_number",
          "location": "body",
          "path": [
            "card_number"
          ],
          "type": "string",
          "description": "Card number (card)"
        },
        {
          "flag": "exp_month",
          "location": "body",
          "path": [
            "exp_month"
          ],
          "type": "string",
          "description": "Two-digit expiry month (card)"
        },
        {
          "flag": "exp_year",
          "location": "body",
          "path": [
            "exp_year"
          ],
          "type": "string",
          "description": "Two-digit expiry year (card)"
        },
        {
          "flag": "cvc",
          "location": "body",
          "path": [
            "cvc"
          ],
          "type": "string",
          "description": "Card security code (card)"
        },
        {
          "flag": "billing.postal_code",
          "location": "body",
          "path": [
            "billing",
            "postal_code"
          ],
          "type": "string",
          "description": "Billing postal code"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v1/payment_methods/{id}",
      "summary": "Retrieve a PaymentMethod",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the PaymentMethod"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list",
      "method": "GET",
      "path": "/v1/payment_methods",
      "summary": "List PaymentMethods",
      "pathParams": [],
      "flags": [
        {
          "flag": "account",
          "location": "query",
          "path": [
            "account"
          ],
          "type": "string",
          "description": "Only return payment methods attached to this Account id"
        },
        {
          "flag": "type",
          "location": "query",
          "path": [
            "type"
          ],
          "type": "string",
          "description": "Only return payment methods of this type",
          "choices": [
            "card",
            "ach"
          ]
        },
        {
          "flag": "limit",
          "location": "query",
          "path": [
            "limit"
          ],
          "type": "integer",
          "description": "Maximum number of payment methods to return (1-100)"
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
    },
    {
      "verb": "block",
      "method": "POST",
      "path": "/v1/payment_methods/{id}/block",
      "summary": "Block a PaymentMethod on the merchant blocklist",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the PaymentMethod"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "unblock",
      "method": "POST",
      "path": "/v1/payment_methods/{id}/unblock",
      "summary": "Remove a PaymentMethod from the merchant blocklist",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the PaymentMethod"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "attach",
      "method": "POST",
      "path": "/v1/payment_methods/{id}/attach",
      "summary": "Attach a PaymentMethod to an Account",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the PaymentMethod"
        }
      ],
      "flags": [
        {
          "flag": "account",
          "location": "body",
          "path": [
            "account"
          ],
          "type": "string",
          "description": "Account id to attach the payment method to"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "detach",
      "method": "POST",
      "path": "/v1/payment_methods/{id}/detach",
      "summary": "Detach a PaymentMethod from its Account",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the PaymentMethod"
        }
      ],
      "flags": [],
      "acceptsBody": false
    }
  ]
};
