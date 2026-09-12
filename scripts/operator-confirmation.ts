/** Keep the durable outbox's existing two-block safety boundary. Viem counts
 * the inclusion block as confirmation one, so receipt waits need three. */
export const OPERATOR_CONFIRMATION_BLOCK_DEPTH = 2n;
export const OPERATOR_RECEIPT_CONFIRMATIONS =
  Number(OPERATOR_CONFIRMATION_BLOCK_DEPTH) + 1;
