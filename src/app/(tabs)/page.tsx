import { Suspense } from "react";
import RecorderClient from "../RecorderClient";

// RecorderClient reads useSearchParams (issue #39's ?writtenAt= sticky
// hand-off from "New recording"), which forces a Suspense boundary at build
// time (Next 16) — same reasoning as login/page.tsx.
export default function Home() {
  return (
    <Suspense>
      <RecorderClient />
    </Suspense>
  );
}
