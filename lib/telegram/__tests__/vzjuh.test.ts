import { approvalCallbackData, callVzjuhTelegram, parseApprovalCallback, verifyVzjuhWebhookSecret } from "../vzjuh";

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

  it("uses the signed relay when direct Telegram egress is unavailable", async () => {
    process.env.VZJUH_TELEGRAM_RELAY_URL = "https://relay.example";
    process.env.VZJUH_TELEGRAM_RELAY_SECRET = "relay-secret";
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    } as Response);
    await expect(callVzjuhTelegram("sendMessage", { chat_id: "1", text: "test" }))
      .resolves.toEqual({ message_id: 42 });
    expect(fetchMock).toHaveBeenCalledWith("https://relay.example/telegram", expect.objectContaining({
      headers: expect.objectContaining({ "x-vzjuh-signature": expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
    fetchMock.mockRestore();
    delete process.env.VZJUH_TELEGRAM_RELAY_URL;
    delete process.env.VZJUH_TELEGRAM_RELAY_SECRET;
  });
});
