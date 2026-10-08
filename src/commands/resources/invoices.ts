import type { ResourceDefinition } from "../../resources/definition.js";

export const invoices: ResourceDefinition = {
  "command": "invoices",
  "description": "Invoices — bills sent to an Account, with their line items",
  "columns": [
    "id",
    "invoice_number",
    "status",
    "account.id",
    "total",
    "currency",
    "due_date"
  ],
  "operations": [
    {
      "verb": "create",
      "method": "POST",
      "path": "/v1/invoices",
      "summary": "Create a draft Invoice",
      "pathParams": [],
      "flags": [
        {
          "flag": "account",
          "location": "body",
          "path": [
            "account"
          ],
          "type": "string",
          "description": "Id of the Account the invoice is billed to"
        },
        {
          "flag": "collection_method",
          "location": "body",
          "path": [
            "collection_method"
          ],
          "type": "string",
          "description": "Charge the Account's default PaymentMethod or email a payment request",
          "choices": [
            "auto_charge",
            "request_payment"
          ]
        },
        {
          "flag": "net_terms",
          "location": "body",
          "path": [
            "net_terms"
          ],
          "type": "integer",
          "description": "Days after issue until the invoice is due"
        },
        {
          "flag": "number",
          "location": "body",
          "path": [
            "number"
          ],
          "type": "string",
          "description": "Your own invoice number; generated when omitted"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Free-text description shown on the invoice"
        },
        {
          "flag": "memo",
          "location": "body",
          "path": [
            "memo"
          ],
          "type": "string",
          "description": "Note printed at the bottom of the invoice"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v1/invoices/{id}",
      "summary": "Retrieve an Invoice",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Invoice"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list",
      "method": "GET",
      "path": "/v1/invoices",
      "summary": "List Invoices",
      "pathParams": [],
      "flags": [
        {
          "flag": "account",
          "location": "query",
          "path": [
            "account"
          ],
          "type": "string",
          "description": "Only return invoices billed to this Account id"
        },
        {
          "flag": "status",
          "location": "query",
          "path": [
            "status"
          ],
          "type": "string",
          "description": "Only return invoices with this status",
          "choices": [
            "draft",
            "outstanding",
            "due",
            "overdue",
            "paid",
            "written_off",
            "voided"
          ]
        },
        {
          "flag": "per_page",
          "location": "query",
          "path": [
            "per_page"
          ],
          "type": "integer",
          "description": "Number of invoices per page (1-100, default 10)"
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
      "verb": "update",
      "method": "PATCH",
      "path": "/v1/invoices/{id}",
      "summary": "Update a draft Invoice",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Invoice"
        }
      ],
      "flags": [
        {
          "flag": "collection_method",
          "location": "body",
          "path": [
            "collection_method"
          ],
          "type": "string",
          "description": "Charge the Account's default PaymentMethod or email a payment request",
          "choices": [
            "auto_charge",
            "request_payment"
          ]
        },
        {
          "flag": "net_terms",
          "location": "body",
          "path": [
            "net_terms"
          ],
          "type": "integer",
          "description": "Days after issue until the invoice is due"
        },
        {
          "flag": "number",
          "location": "body",
          "path": [
            "number"
          ],
          "type": "string",
          "description": "Your own invoice number"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Free-text description shown on the invoice"
        },
        {
          "flag": "memo",
          "location": "body",
          "path": [
            "memo"
          ],
          "type": "string",
          "description": "Note printed at the bottom of the invoice"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "issue",
      "method": "POST",
      "path": "/v1/invoices/{id}/issue",
      "summary": "Issue a draft Invoice to its Account",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Invoice"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list-line-items",
      "method": "GET",
      "path": "/v1/invoices/{invoice_id}/line_items",
      "summary": "List an Invoice's line items",
      "pathParams": [
        {
          "name": "invoice_id",
          "description": "Id of the Invoice"
        }
      ],
      "flags": [],
      "acceptsBody": false,
      "columns": [
        "id",
        "description",
        "quantity",
        "unit_amount_cents",
        "unit_amount_currency"
      ]
    },
    {
      "verb": "create-line-item",
      "method": "POST",
      "path": "/v1/invoices/{invoice_id}/line_items",
      "summary": "Add a line item to a draft Invoice",
      "pathParams": [
        {
          "name": "invoice_id",
          "description": "Id of the Invoice"
        }
      ],
      "flags": [
        {
          "flag": "product",
          "location": "body",
          "path": [
            "product"
          ],
          "type": "string",
          "description": "Id of the Product being billed"
        },
        {
          "flag": "quantity",
          "location": "body",
          "path": [
            "quantity"
          ],
          "type": "integer",
          "description": "Number of units"
        }
      ],
      "acceptsBody": true,
      "columns": [
        "id",
        "description",
        "quantity",
        "unit_amount_cents",
        "unit_amount_currency"
      ]
    },
    {
      "verb": "retrieve-line-item",
      "method": "GET",
      "path": "/v1/invoices/{invoice_id}/line_items/{id}",
      "summary": "Retrieve an Invoice line item",
      "pathParams": [
        {
          "name": "invoice_id",
          "description": "Id of the Invoice"
        },
        {
          "name": "id",
          "description": "Id of the line item"
        }
      ],
      "flags": [],
      "acceptsBody": false,
      "columns": [
        "id",
        "description",
        "quantity",
        "unit_amount_cents",
        "unit_amount_currency"
      ]
    },
    {
      "verb": "update-line-item",
      "method": "PATCH",
      "path": "/v1/invoices/{invoice_id}/line_items/{id}",
      "summary": "Update a line item on a draft Invoice",
      "pathParams": [
        {
          "name": "invoice_id",
          "description": "Id of the Invoice"
        },
        {
          "name": "id",
          "description": "Id of the line item"
        }
      ],
      "flags": [
        {
          "flag": "quantity",
          "location": "body",
          "path": [
            "quantity"
          ],
          "type": "integer",
          "description": "Number of units"
        }
      ],
      "acceptsBody": true,
      "columns": [
        "id",
        "description",
        "quantity",
        "unit_amount_cents",
        "unit_amount_currency"
      ]
    },
    {
      "verb": "delete-line-item",
      "method": "DELETE",
      "path": "/v1/invoices/{invoice_id}/line_items/{id}",
      "summary": "Remove a line item from a draft Invoice",
      "pathParams": [
        {
          "name": "invoice_id",
          "description": "Id of the Invoice"
        },
        {
          "name": "id",
          "description": "Id of the line item"
        }
      ],
      "flags": [],
      "acceptsBody": false,
      "columns": [
        "id",
        "description",
        "quantity",
        "unit_amount_cents",
        "unit_amount_currency"
      ]
    }
  ]
};
