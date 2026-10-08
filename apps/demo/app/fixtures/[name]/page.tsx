import { notFound } from "next/navigation";
import { fixtures } from "../../../fixtures";
import { FixtureDashboard } from "../fixture-dashboard";

export const metadata = { title: "Visual fixtures", robots: { index: false } };

// Only the fixtures that exist; any other name is a 404.
export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(fixtures).map((name) => ({ name }));

/** The fixture gallery: saved specs with recorded results, for visual tests (ADR 0008). */
export default async function FixturePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!fixtures[name]) notFound();
  return (
    <main>
      <FixtureDashboard name={name} />
    </main>
  );
}
