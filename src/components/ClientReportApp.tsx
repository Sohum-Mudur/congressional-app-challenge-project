"use client";

import dynamic from "next/dynamic";

// The report flow depends on GPS, localStorage and the map, all browser-only, so skip server rendering.
const ReportApp = dynamic(() => import("./ReportApp"), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-neutral-500">Loading map…</p>,
});

export default ReportApp;
