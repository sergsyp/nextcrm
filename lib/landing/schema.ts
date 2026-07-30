import { z } from "zod";

export const landingContentSchema = z.object({
  headline: z.string().min(1).max(160),
  subheadline: z.string().max(400).optional(),
  problem: z.string().max(2000).optional(),
  offer: z.string().min(1).max(4000),
  benefits: z.array(z.string().min(1).max(500)).max(12).default([]),
  pricing: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        price: z.string().min(1).max(100),
        details: z.string().max(1000).optional(),
      })
    )
    .max(6)
    .default([]),
  cta: z.string().min(1).max(160),
  contactEmail: z.string().email().optional(),
});

export type LandingContent = z.infer<typeof landingContentSchema>;

export function parseLandingContent(value: string): LandingContent {
  return landingContentSchema.parse(JSON.parse(value));
}

export const landingSlugSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
