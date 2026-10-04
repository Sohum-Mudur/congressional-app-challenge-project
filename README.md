# Signal Report (working name)

**Stuck at a red light with no cross traffic? Report it in one tap, and we get it to the agency that actually fixes it.**

Built in Hillsborough, NJ for the 2026 Congressional App Challenge.

## The problem

Many traffic lights detect waiting cars with sensors in the road. When a sensor breaks, the light can stay red with nobody coming the other way. Drivers wait for nothing, burn fuel, and sometimes run the light out of frustration.

Hardly anyone reports it, because **nobody knows who owns the light.** In New Jersey it depends on the road:

| Road at the intersection | Who owns the light | Example in Hillsborough |
|---|---|---|
| Interstate, US or NJ route | NJ Department of Transportation | US 206 & Amwell Rd |
| County route (CR 5xx/6xx) | County engineering | Amwell Rd (CR 514) & Beekman Ln |
| Anything else | The township | Triangle Rd & Auten Rd |

## What the app does

1. **One-tap report.** It matches your GPS position to the nearest of Hillsborough's 38 signalized intersections and guesses which way you were going from your phone's heading.
2. **Routes it automatically.** It reads which roads meet at that light from OpenStreetMap and works out the owner using the rules above.
3. **Combines reports into evidence.** When **3+ reports from 2+ different people** arrive within 7 days, the owner gets one short daily summary: what's wrong, which direction, how long people waited, and a map link. Agencies ignore floods of single complaints; they act on patterns.
4. **Closes the loop.** Each email has a private link where staff mark a light "on it" or "fixed" without creating an account. The public map updates.
5. **Shows the impact.** The Impact page adds up time wasted and estimated CO₂ from idling.

**Safety:** NJ bans handheld phone use while driving. Before a report, the app asks whether you're driving. If you are, one tap saves the spot and you finish the report once you're parked.

## How it's built

```
Phone (Next.js web app, installable)
  │  GPS → snap to nearest signal (src/lib/geo.ts)
  ▼
POST /api/reports ── validate (zod), rate-limit, anonymous device cookie
  ▼
Store (src/lib/store) ── Supabase Postgres (local JSON fallback offline)
  ▼
Daily cron → /api/digest
  signalsDueForDigest() → groupByAgency() → renderDigestEmail()   (src/lib/digest.ts)
  ▼
Email (Resend) → agency → /agency/<secret link> → "Mark fixed"
```

| Piece | Tech |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS |
| Map | MapLibre GL with free OpenFreeMap tiles |
| Signal data | OpenStreetMap via the Overpass API (`scripts/import-signals.ts`) |
| Database | Supabase Postgres with Row Level Security (`supabase/migrations`); falls back to a local JSON file when Supabase isn't configured |
| Email | Resend; falls back to a local outbox at `/dev/outbox` |
| Tests | Vitest (`src/lib/*.test.ts`) |
| Hosting | Vercel, with Vercel Cron for the daily digest |

### Interesting problems we solved

- **Divided highways.** OSM puts a separate signal node on each side of a divided road, so US 206 & Brooks Blvd showed up as 4 lights. `buildSignals()` merges nodes within 40 m, which turned 64 nodes into 38 real intersections.
- **Who owns a light.** `ownerForRoads()` ranks every road through the intersection (state > county > township). A light where US 206 crosses a county road therefore goes to NJDOT, which owns the signals on state highways.
- **Spam and fairness.** Reports need 2+ different devices, repeats from the same device within 30 minutes are ignored, and there's a daily cap.
- **Agencies without email.** NJDOT and Somerset County only take web forms, so their digests go to our admin with an "Action needed: submit via form" banner.

## Running it

```bash
npm install          # also copies MapLibre's worker into public/maplibre
npm run dev          # http://localhost:3000
npm test             # unit tests
npm run import:signals -- "Hillsborough Township" "Somerset"   # refresh signal data from OSM
npm run db:migrate   # create/update database tables (needs DATABASE_URL)
npm run db:seed      # load data/signals and data/agencies into the database
```

Try the whole loop locally:
1. Open a light (tap it, or `/?signal=osm-105373726`) → **Report this light**.
2. Reports need 3 different devices, so add two more from private windows, or with `curl` using separate cookie jars.
3. Open `/dev/outbox` → **Run digest now** to see the email.
4. Follow the "Mark signals as fixed" link in the email.

Copy `.env.example` to `.env.local` to configure email. **`TEST_MODE` stays `true` until an agency has agreed to get reports**, so every email goes to your own inbox until then.

## Data sources and credits

- Traffic signals and roads: © OpenStreetMap contributors (ODbL)
- Map tiles: OpenFreeMap / OpenMapTiles
- Agency contacts: each entry in `data/agencies.json` links to its source page and is marked `verified: false` until confirmed by phone.
- Idling estimate: US DOE (¼–½ gallon per hour idling; we use ¼). CO₂ per gallon: US EPA (8,887 g).
