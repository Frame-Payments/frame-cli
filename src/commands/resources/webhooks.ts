import type { ResourceDefinition } from "../../resources/definition.js";

export const webhooks: ResourceDefinition = {
  "command": "webhooks",
  "description": "Webhooks — endpoints that receive your events",
  "columns": [
    "id",
    "url",
    "status",
    "events",
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
        "name": "events",
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
          "flag": "limit",
          "location": "query",
          "path": [
            "limit"
          ],
          "type": "integer",
          "description": "Maximum number of endpoints to return (1-100)"
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
        },
        {
          "flag": "status",
          "location": "body",
          "path": [
            "status"
          ],
          "type": "string",
          "description": "Pause (disabled) or resume (enabled) deliveries",
          "choices": [
            "enabled",
            "disabled"
          ]
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
