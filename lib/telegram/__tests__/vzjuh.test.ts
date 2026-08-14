import { approvalCallbackData, parseApprovalCallback, verifyVzjuhWebhookSecret } from "../vzjuh";

describe("vzjuh Telegram helpers", () => {
  const id = "ea3c0bd8-96fb-4666-b438-e62c8e0d0df2";

  it("builds and parses one-time approval callbacks", () => {
    expect(parseApprovalCallback(approvalCallbackData(id, "approve"))).toEqual({ id, decision: "APPROVED" });
    expect(parseApprovalCallback(approvalCallbackData(id, "reject"))).toEqual({ id, decision: "REJECTED" });
    expect(parseApprovalCallback("approval:not-a-uuid:approve")).toBeNull();
  });

  it("compares the webhook secret without accepting missing values", () => {
    process.env.VZJUH_TELEGRAM_WEBHOOK_SECRET = "stage-secret";
    expect(verifyVzjuhWebhookSecret("stage-secret")).toBe(true);
    expect(verifyVzjuhWebhookSecret("wrong-secret")).toBe(false);
    expect(verifyVzjuhWebhookSecret(null)).toBe(false);
  });
});
