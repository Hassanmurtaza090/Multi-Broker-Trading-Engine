/**
 * Order status → badge tone mapping (order lifecycle, backend OrderStatus).
 */

export type StatusTone = "ok" | "warn" | "danger" | "muted" | "info";

export function orderStatusTone(status: string): StatusTone {
  switch (status) {
    case "FILLED":
      return "ok";
    case "REJECTED":
    case "EXPIRED":
      return "danger";
    case "CANCELLED":
      return "muted";
    case "SUBMITTED":
    case "PARTIALLY_FILLED":
      return "info";
    default:
      return "warn"; // NEW / PENDING_SUBMIT / PENDING_CANCEL
  }
}
