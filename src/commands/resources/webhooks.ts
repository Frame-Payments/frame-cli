import type { ResourceDefinition } from "../../resources/definition.js";

export const webhooks: ResourceDefinition = {
  "command": "webhooks",
  "description": "Webhooks — endpoints that receive your events",
  "columns": [
    "id",
    "url",
    "status",
    "event_codes",
    "secret"
  ],
  "operations": [
    {
      "verb": "create",
      "method": "POST",
      "path": "/v1/webhook_endpoints",
      "summary": "Create a Webhook endpoint",
      "pathParams": [],
      "bodyArgument": {
        "name": "event_codes",
        "description": "Event codes to deliver to the endpoint"
      },
      "flags": [
        {
          "flag": "url",
          "location": "body",
          "path": [
            "url"
          ],
          "type": "string",
          "description": "HTTPS URL the events are delivered to"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Free-text description of the endpoint"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v1/webhook_endpoints/{id}",
      "summary": "Retrieve a Webhook endpoint",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Webhook endpoint"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list",
      "method": "GET",
      "path": "/v1/webhook_endpoints",
      "summary": "List Webhook endpoints",
      "pathParams": [],
      "flags": [
        {
          "flag": "per_page",
          "location": "query",
          "path": [
            "per_page"
          ],
          "type": "integer",
          "description": "Number of endpoints per page (1-100, default 10)"
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
      "path": "/v1/webhook_endpoints/{id}",
      "summary": "Update a Webhook endpoint",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Webhook endpoint"
        }
      ],
      "flags": [
        {
          "flag": "url",
          "location": "body",
          "path": [
            "url"
          ],
          "type": "string",
          "description": "HTTPS URL the events are delivered to"
        },
        {
          "flag": "description",
          "location": "body",
          "path": [
            "description"
          ],
          "type": "string",
          "description": "Free-text description of the endpoint"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "delete",
      "method": "DELETE",
      "path": "/v1/webhook_endpoints/{id}",
      "summary": "Delete a Webhook endpoint",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Webhook endpoint"
        }
      ],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "rotate-secret",
      "method": "POST",
      "path": "/v1/webhook_endpoints/{id}/rotate_secret",
      "summary": "Replace a Webhook endpoint's signing secret with a new one",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Webhook endpoint"
        }
      ],
      "flags": [],
      "acceptsBody": false
    }
  ]
};
