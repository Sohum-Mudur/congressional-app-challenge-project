import QRCode from "qrcode";
import { config } from "@/lib/config";
import InstallButton from "./InstallButton";

export const metadata = { title: "Get the app · Signal Report" };

export default async function InstallPage() {
  const qr = await QRCode.toString(config.siteUrl, { type: "svg", margin: 1, color: { dark: "#171717", light: "#ffffff" } });

  return (
    <main className="mx-auto w-full max-w-2xl p-4 leading-relaxed">
      <h1 className="text-2xl font-bold">Get the app</h1>
      <p className="mt-1 text-neutral-600">
        Add Signal Report to your home screen. It opens full-screen like any other app, with no App Store download.
      </p>

      <InstallButton />

      <section className="mt-6 rounded-2xl bg-white p-4 ring-1 ring-black/5">
        <h2 className="text-lg font-bold">iPhone</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Open this page in <strong>Safari</strong>.
          </li>
          <li>
            Tap the <strong>Share</strong> button (the square with an arrow pointing up). On newer iPhones it may be under the <strong>⋯</strong> menu.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
        </ol>
      </section>

      <section className="mt-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
        <h2 className="text-lg font-bold">Android</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            Open this page in <strong>Chrome</strong>.
          </li>
          <li>
            Tap <strong>Install the app</strong> above, or the <strong>⋮</strong> menu → <strong>Add to Home screen</strong> / <strong>Install app</strong>.
          </li>
        </ol>
      </section>

      <section className="mt-3 flex flex-col items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-black/5 sm:flex-row">
        <div className="h-40 w-40 shrink-0" aria-label={`QR code for ${config.siteUrl}`} role="img" dangerouslySetInnerHTML={{ __html: qr }} />
        <div>
          <h2 className="text-lg font-bold">On a computer?</h2>
          <p className="mt-1 text-neutral-600">Point your phone&apos;s camera at this code to open the app there.</p>
          <p className="mt-1 break-all text-sm text-neutral-500">{config.siteUrl.replace(/^https?:\/\//, "")}</p>
        </div>
      </section>

      <p className="mt-6 text-sm text-neutral-500">
        When asked, allow location access. It&apos;s only used to find the traffic light you&apos;re at, and is never saved on our servers.
      </p>
    </main>
  );
}
