import { AI_AGENT_DEFINITIONS } from "../definitions";
import { AI_TEAM_KNOWLEDGE } from "../team-knowledge";

describe("AI team configuration", () => {
  it("defines exactly the three approved autonomous CRM roles", () => {
    expect(AI_AGENT_DEFINITIONS.map((agent) => agent.key)).toEqual([
      "researcher",
      "sales",
      "controller",
    ]);
  });

  it("does not give any role a destructive tool", () => {
    for (const agent of AI_AGENT_DEFINITIONS) {
      expect(agent.toolNames.filter((name) => name.includes("delete"))).toEqual(
        []
      );
    }
  });

  it("keeps external send and publication tools outside autonomous tool sets", () => {
    for (const agent of AI_AGENT_DEFINITIONS) {
      expect(agent.toolNames).not.toContain("campaigns_send");
      expect(agent.toolNames).not.toContain("campaigns_resume");
      expect(agent.toolNames).not.toContain("landing_publish");
    }
  });

  it("allows the salesperson to prepare campaigns but not launch them", () => {
    const sales = AI_AGENT_DEFINITIONS.find((agent) => agent.key === "sales");
    expect(sales?.toolNames).toContain("campaigns_create");
    expect(sales?.toolNames).toContain("campaigns_create_step");
    expect(sales?.toolNames).not.toContain("campaigns_send");
  });

  it("documents CRM logging, approvals, communications, boards, and landing limits", () => {
    const content = AI_TEAM_KNOWLEDGE.map((document) => document.content).join(
      "\n"
    );
    expect(content).toContain("Если действие не записано в CRM");
    expect(content).toContain("первое сообщение новому клиенту");
    expect(content).toContain("самостоятельно продолжает ту же переписку");
    expect(content).toContain("типовой доской Projects/Boards");
    expect(content).toContain("crm_send_individual_email");
    expect(content).toContain("Target ID");
    expect(content).toContain("без повторного SMTP");
    expect(content).toContain("crm_publish_landing");
    expect(content).toContain("Встроенного визуального");
    expect(content).toContain("Ночной поиск и дневные квоты");
    expect(content).toContain("AI-расходы");
    expect(content).toContain("Алиса → Роман");
    expect(content).toContain("@vzjuh_bot является штатным каналом NextCRM");
    expect(content).toContain("crm_request_sergey_approval");
  });

  it("keeps deterministic handoffs in code and agent verdicts structured", () => {
    const researcher = AI_AGENT_DEFINITIONS.find((agent) => agent.key === "researcher")!;
    const controller = AI_AGENT_DEFINITIONS.find((agent) => agent.key === "controller")!;
    expect(researcher.instructions).toContain("код проверит новые Target и передаст пакет Роману");
    expect(controller.instructions).toContain("машинно-читаемого вердикта");
    expect(controller.instructions).toContain("не создавай передачу Марку вручную");
  });
});
