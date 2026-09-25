import Link from "next/link";

export const metadata = { title: "About · Signal Report" };

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl p-4 leading-relaxed">
      <h1 className="text-2xl font-bold">Why this exists</h1>
      <p className="mt-3">
        Many traffic lights use sensors buried in the road to detect waiting cars. When a sensor breaks, the light can stay red with no cross traffic at all, and drivers
        sit there for minutes for no reason. Most people don&apos;t report it because they don&apos;t know who to tell.
      </p>
      <p className="mt-3">
        In New Jersey the answer depends on the road. Lights on state highways like US 206 belong to NJDOT, lights on county roads like Amwell Road (CR 514) belong to the
        county, and the rest belong to the township.
      </p>

      <h2 className="mt-6 text-lg font-bold">How it works</h2>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5">
        <li>Tap one button. Your location is matched to the nearest traffic light.</li>
        <li>The app looks up which roads meet there and works out who owns that light.</li>
        <li>Reports are combined. When 3 or more people report the same light within a week, the owner gets one clear summary instead of a pile of complaints.</li>
        <li>The agency marks it fixed with one click, and the map updates.</li>
      </ol>

      <h2 className="mt-6 text-lg font-bold">Safety first</h2>
      <p className="mt-2">
        Never use your phone while driving. If you&apos;re behind the wheel, one tap saves the spot and you finish the report once you&apos;re parked.
      </p>

      <h2 className="mt-6 text-lg font-bold">Data</h2>
      <p className="mt-2">
        Traffic light locations and road data come from{" "}
        <a className="text-sky-700" href="https://www.openstreetmap.org/copyright">
          © OpenStreetMap contributors
        </a>
        . We don&apos;t ask for your name. Each device gets an anonymous id so we can tell that two reports came from different people.
      </p>

      <p className="mt-8 text-sm text-neutral-500">
        Built by students in Hillsborough, NJ for the Congressional App Challenge. <Link href="/impact" className="text-sky-700">See the impact →</Link>
      </p>
    </main>
  );
}
