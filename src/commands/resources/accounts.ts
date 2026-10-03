import type { ResourceDefinition } from "../../resources/definition.js";

export const accounts: ResourceDefinition = {
  "command": "accounts",
  "description": "Accounts — the parties a merchant transacts with",
  "columns": [
    "id",
    "type",
    "status",
    "external_id"
  ],
  "operations": [
    {
      "verb": "create",
      "method": "POST",
      "path": "/v1/accounts",
      "summary": "Create an Account",
      "pathParams": [],
      "bodyArguments": [],
      "flags": [
        {
          "flag": "type",
          "location": "body",
          "path": [
            "type"
          ],
          "type": "string",
          "description": "Kind of party the Account represents",
          "choices": [
            "individual",
            "business"
          ]
        },
        {
          "flag": "external_id",
          "location": "body",
          "path": [
            "external_id"
          ],
          "type": "string",
          "description": "Your own identifier for this Account"
        },
        {
          "flag": "terms_of_service.accepted_at",
          "location": "body",
          "path": [
            "terms_of_service",
            "accepted_at"
          ],
          "type": "string",
          "description": "ISO 8601 time the party accepted the terms of service"
        },
        {
          "flag": "terms_of_service.ip_address",
          "location": "body",
          "path": [
            "terms_of_service",
            "ip_address"
          ],
          "type": "string",
          "description": "IP address the terms of service were accepted from"
        },
        {
          "flag": "profile.individual.name.first_name",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "name",
            "first_name"
          ],
          "type": "string",
          "description": "Legal first name"
        },
        {
          "flag": "profile.individual.name.last_name",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "name",
            "last_name"
          ],
          "type": "string",
          "description": "Legal last name"
        },
        {
          "flag": "profile.individual.email",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "email"
          ],
          "type": "string",
          "description": "Email address"
        },
        {
          "flag": "profile.individual.phone_number",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "phone_number"
          ],
          "type": "string",
          "description": "Phone number in E.164 format"
        },
        {
          "flag": "profile.individual.birthdate",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "birthdate"
          ],
          "type": "string",
          "description": "Date of birth (YYYY-MM-DD)"
        },
        {
          "flag": "profile.individual.address.line_1",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "address",
            "line_1"
          ],
          "type": "string",
          "description": "Street address"
        },
        {
          "flag": "profile.individual.address.city",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "address",
            "city"
          ],
          "type": "string",
          "description": "City"
        },
        {
          "flag": "profile.individual.address.state",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "address",
            "state"
          ],
          "type": "string",
          "description": "Two-letter state code"
        },
        {
          "flag": "profile.individual.address.postal_code",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "address",
            "postal_code"
          ],
          "type": "string",
          "description": "Postal code"
        },
        {
          "flag": "profile.individual.address.country",
          "location": "body",
          "path": [
            "profile",
            "individual",
            "address",
            "country"
          ],
          "type": "string",
          "description": "Two-letter ISO country code"
        },
        {
          "flag": "profile.business.legal_business_name",
          "location": "body",
          "path": [
            "profile",
            "business",
            "legal_business_name"
          ],
          "type": "string",
          "description": "Registered business name"
        },
        {
          "flag": "profile.business.email",
          "location": "body",
          "path": [
            "profile",
            "business",
            "email"
          ],
          "type": "string",
          "description": "Business email address"
        }
      ],
      "acceptsBody": true
    },
    {
      "verb": "retrieve",
      "method": "GET",
      "path": "/v1/accounts/{id}",
      "summary": "Retrieve an Account",
      "pathParams": [
        {
          "name": "id",
          "description": "Id of the Account"
        }
      ],
      "bodyArguments": [],
      "flags": [],
      "acceptsBody": false
    },
    {
      "verb": "list",
      "method": "GET",
      "path": "/v1/accounts",
      "summary": "List Accounts",
      "pathParams": [],
      "bodyArguments": [],
      "flags": [
        {
          "flag": "type",
          "location": "query",
          "path": [
            "type"
          ],
          "type": "string",
          "description": "Only return accounts of this type",
          "choices": [
            "individual",
            "business"
          ]
        },
        {
          "flag": "limit",
          "location": "query",
          "path": [
            "limit"
          ],
          "type": "integer",
          "description": "Maximum number of accounts to return (1-100)"
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
