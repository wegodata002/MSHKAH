import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffScreen } from "@/features/staff/staff-screen";

export const metadata: Metadata = {
  title: "MISHKAT · Staff",
  robots: { index: false, follow: false },
};

/** Where the "Couriers" and "Waiters" QR codes lead: personal 4-digit code, then the role's screen. */
export default function StaffPage() {
  return (
    <Suspense>
      <StaffScreen />
    </Suspense>
  );
}
