import { notFound } from "next/navigation";
import { prismadb } from "@/lib/prisma";
import { parseLandingContent } from "@/lib/landing/schema";

export default async function PublicLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const document = await prismadb.documents.findFirst({
    where: {
      deletedAt: null,
      tags: {
        path: ["landing", "slug"],
        equals: slug,
      },
      AND: {
        tags: {
          path: ["landing", "status"],
          equals: "published",
        },
      },
    },
    select: { document_name: true, content_text: true },
  });
  if (!document?.content_text) notFound();

  let content;
  try {
    content = parseLandingContent(document.content_text);
  } catch {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{content.headline}</h1>
        {content.subheadline && (
          <p className="mx-auto mt-6 max-w-3xl text-xl text-slate-300">{content.subheadline}</p>
        )}
        <div className="mx-auto mt-12 max-w-3xl rounded-3xl bg-white/10 p-8 text-left">
          {content.problem && <p className="text-slate-300">{content.problem}</p>}
          <p className="mt-4 text-lg">{content.offer}</p>
          {content.benefits.length > 0 && (
            <ul className="mt-6 space-y-3">
              {content.benefits.map((benefit) => <li key={benefit}>✓ {benefit}</li>)}
            </ul>
          )}
        </div>
        {content.pricing.length > 0 && (
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {content.pricing.map((item) => (
              <article key={item.name} className="rounded-2xl border border-white/15 p-6">
                <h2 className="text-xl font-semibold">{item.name}</h2>
                <p className="mt-3 text-2xl font-bold">{item.price}</p>
                {item.details && <p className="mt-3 text-slate-300">{item.details}</p>}
              </article>
            ))}
          </div>
        )}
        <div className="mt-12">
          {content.contactEmail ? (
            <a
              className="inline-flex rounded-full bg-white px-7 py-3 font-semibold text-slate-950"
              href={`mailto:${content.contactEmail}`}
            >
              {content.cta}
            </a>
          ) : (
            <p className="text-xl font-semibold">{content.cta}</p>
          )}
        </div>
      </section>
    </main>
  );
}
