// "Notify me when fixed": the one email a reporter gets when the agency marks their light fixed.
// Closing the loop matters: people keep reporting when they can see that reports lead to repairs.

import { esc } from "./digest";
import type { Signal } from "./signals";

export function renderFixedEmail(signal: Pick<Signal, "id" | "name">, agencyName: string, links: { mapUrl: string }) {
  const subject = `Fixed: the traffic light at ${signal.name}`;
  const text = [
    "Good news!",
    "",
    `${agencyName} has marked the traffic light at ${signal.name} as fixed. Thanks for reporting it.`,
    "",
    `If it's still not working, report it again and we'll let them know: ${links.mapUrl}`,
    "",
    "— You asked for this one email when you reported the light. We've now deleted your email address.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
<p style="font-size:18px"><strong>Good news!</strong></p>
<p>${esc(agencyName)} has marked the traffic light at <strong>${esc(signal.name)}</strong> as fixed. Thanks for reporting it.</p>
<p>If it's still not working, <a href="${esc(links.mapUrl)}">report it again</a> and we'll let them know.</p>
<p style="color:#666;font-size:12px">You asked for this one email when you reported the light. We've now deleted your email address.</p>
</div>`;
  return { subject, text, html };
}
