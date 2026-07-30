import { landingSlugSchema, parseLandingContent } from "../schema";

describe("landing schema", () => {
  test("accepts safe structured landing content", () => {
    expect(
      parseLandingContent(
        JSON.stringify({
          headline: "Проверяем гипотезу",
          offer: "Практическое предложение",
          benefits: ["Быстро", "Проверяемо"],
          cta: "Оставить заявку",
        })
      ).headline
    ).toBe("Проверяем гипотезу");
  });

  test("allows only URL-safe slugs", () => {
    expect(landingSlugSchema.safeParse("crm-audit").success).toBe(true);
    expect(landingSlugSchema.safeParse("../admin").success).toBe(false);
  });
});
