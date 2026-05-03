/**
 * Canonical event lists for `frame trigger`.
 *
 * Kept in a separate module so that src/cli.ts can import the constants for
 * help-text generation without eagerly loading the full trigger command
 * (which would pull in keyring → keytar at startup).
 */

/** The 16 canonical event codes supported in v1. */
export const SUPPORTED_EVENTS: readonly string[] = [
  "account.created",
  "account.updated",
  "account.restricted",
  "account.unrestricted",
  "capability.requested",
  "capability.approved",
  "capability.denied",
  "capability.disabled",
  "transfer.created",
  "transfer.completed",
  "transfer.cancelled",
  "transfer.updated",
  "refund.created",
  "refund.completed",
  "invoice.created",
  "invoice.paid",
];

/** Deprecated event codes → canonical equivalent hint. */
export const DEPRECATED_EVENTS: Readonly<Record<string, string>> = {
  "customer.created": "frame accounts create",
  "customer.updated": "frame accounts update",
  "customer.deleted": "frame accounts update",
  "charge_intent.created": "frame transfers create",
  "charge_intent.completed": "frame trigger transfer.completed",
  "charge_intent.cancelled": "frame trigger transfer.cancelled",
  "payout.created": "frame transfers create",
  "charge.created": "frame transfers create",
};
