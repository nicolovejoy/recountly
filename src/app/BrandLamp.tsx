"use client";

// The header wordmark, doubling as a "REC lamp" (classic recording-light
// look) reflecting live recorder status via lampStyle. Also a link home
// (Capture tab). Status comes from CaptureGuard, which RecorderClient keeps
// in sync; on non-Capture tabs the recorder is unmounted so this reads
// "idle" (muted green) — expected.

import Link from "next/link";
import { lampStyle } from "@/lib/lamp";
import { useCaptureGuard } from "./CaptureGuard";

export default function BrandLamp() {
  const { status } = useCaptureGuard();
  const { bg, text, pulse } = lampStyle(status);

  return (
    <Link
      href="/"
      className={`rounded-full px-3 py-1 text-2xl font-semibold tracking-tight transition-colors ${bg} ${text} ${
        pulse ? "animate-pulse" : ""
      }`}
    >
      recountly
    </Link>
  );
}
