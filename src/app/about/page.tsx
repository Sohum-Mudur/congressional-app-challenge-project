import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata = { title: `About · ${APP_NAME}` };

// Written by the team. Keep the wording as they wrote it.
export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl p-4 leading-relaxed">
      <h1 className="text-2xl font-bold">Why we created {APP_NAME}</h1>
      <p className="mt-3">
        Many traffic lights use sensors buried in the road to detect waiting cars. When a sensor breaks, the light can often stay red with no cross traffic at all,
        and drivers sit there for minutes for no reason. People choose not to report it because they either don&rsquo;t have the time, or don&rsquo;t know who to
        tell.
      </p>
      <p className="mt-3">
        In New Jersey, the answer depends on the road and who owns it. Lights on state highways like US 206 belong to NJDOT, lights on county roads like Amwell Road
        (CR 514) belong to the county, and the rest belong to the township.
      </p>
      <p className="mt-3">We have streamlined the reporting process into a basic web application that allows people to easily report specific traffic lights.</p>

      <h2 className="mt-6 text-lg font-bold">How our app works:</h2>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5">
        <li>Tap one button. Your location is matched to the nearest traffic light.</li>
        <li>The app looks up which roads meet there and works out who owns that light.</li>
        <li>
          Reports are combined. When 3 or more people report the same light within a week, the owner gets one clear summary instead of a pile of complaints.
        </li>
        <li>The agency marks it fixed with one click, the map updates, and anyone who asked is notified via email.</li>
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
        .
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>We don&apos;t ask for your name and there are no accounts.</li>
        <li>Your location is only used to find the light you&apos;re at. We save which light you reported, not where you were.</li>
        <li>
          To tell that reports came from different people, each device gets a random id, and we keep a scrambled code made from your internet connection (never the
          address itself).
        </li>
        <li>If you ask to be emailed when a light is fixed, we use your address for that one email and then delete it.</li>
      </ul>

      <p className="mt-8 text-sm text-neutral-500">
        Built by students from Hillsborough, NJ. <Link href="/impact" className="text-sky-700">See the impact →</Link>{" "}
        <Link href="/install" className="text-sky-700">Get the app →</Link>
      </p>
    </main>
  );
}
