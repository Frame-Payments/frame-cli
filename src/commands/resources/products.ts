import type { ResourceDefinition } from "../../resources/definition.js";

export const products: ResourceDefinition = {
  "command": "products",
  "description": "Products — goods and services you bill for",
  "columns": [
    "id",
    "name",
    "active",
    "default_price",
    "purchase_type",
    "recurring_interval"
  ],
  "operations": [
    {
      "verb": "create",
      "method": "POST",
      "path": "/v1/products",
      "summary": "Create a Product",
      "pathParams": [],
      "flags": [
        {
          "flag": "name",
          "location": "body",
          "path": [
            "name"
          ],
          "type": "string",
          "description": "Name shown to the buyer"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Longer description shown to the buyer"
        },
        {
          "flag": "default_price",
          "location": "body",
          "path": [
            "default_price"
          ],
          "type": "integer",
          "description": "Price in the smallest currency unit"
        },
        {
          "flag": "purchase_type",
          "location": "body",
          "path": [
            "purchase_type"
          ],
          "type": "string",
          "description": "Sold once or on a recurring schedule",
          "choices": [
            "one_time",
            "recurring"
          ]
        },
        {
          "flag": "recurring_interval",
          "location": "body",
          "path": [
            "recurring_interval"
          ],
          "type": "string",
          "description": "Billing interval of a recurring product",
          "choices": [
            "daily",
            "weekly",
            "monthly",
            "every_3_months",
            "every_6_months",
            "yearly"
          ]
        },
        {
          "flag": "shippable",
          "location": "body",
          "path": [
            "shippable"
          ],
          "type": "boolean",
          "description": "Whether the product is physically shipped"
        },
        {
          "flag": "url",
          "location": "body",
          "path": [
            "url"
          ],
          "type": "string",
          "description": "Public URL of the product"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v1/products/{id}",
      "summary": "Retrieve a Product",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Product"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list",
      "method": "GET",
      "path": "/v1/products",
      "summary": "List Products",
      "pathParams": [],
      "flags": [
        {
          "flag": "active",
          "location": "query",
          "path": [
            "active"
          ],
          "type": "boolean",
          "description": "Only return active (true) or archived (false) products"
        },
        {
          "flag": "per_page",
          "location": "query",
          "path": [
            "per_page"
          ],
          "type": "integer",
          "description": "Number of products per page (1-100, default 10)"
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
      "path": "/v1/products/{id}",
      "summary": "Update a Product",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Product"
        }
      ],
      "flags": [
        {
          "flag": "name",
          "location": "body",
          "path": [
            "name"
          ],
          "type": "string",
          "description": "Name shown to the buyer"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Longer description shown to the buyer"
        },
        {
          "flag": "default_price",
          "location": "body",
          "path": [
            "default_price"
          ],
          "type": "integer",
          "description": "Price in the smallest currency unit"
        },
        {
          "flag": "shippable",
          "location": "body",
          "path": [
            "shippable"
          ],
          "type": "boolean",
          "description": "Whether the product is physically shipped"
        },
        {
          "flag": "url",
          "location": "body",
          "path": [
            "url"
          ],
          "type": "string",
          "description": "Public URL of the product"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "delete",
      "method": "DELETE",
      "path": "/v1/products/{id}",
      "summary": "Delete a Product",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Product"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "search",
      "method": "GET",
      "path": "/v1/products/search",
      "summary": "Search Products by name",
      "pathParams": [],
      "flags": [
        {
          "flag": "name",
          "location": "query",
          "path": [
            "name"
          ],
          "type": "string",
          "description": "Text to match against product names"
        },
        {
          "flag": "active",
          "location": "query",
          "path": [
            "active"
          ],
          "type": "boolean",
          "description": "Only return active (true) or archived (false) products"
        }
      ],
      "acceptsBody": false,
      "rows": "products"
    }
  ]
};
