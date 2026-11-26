import type { Metadata } from "next";
import { WaiterJoinScreen } from "@/features/staff/waiter-join-screen";

export const metadata: Metadata = {
  title: "MISHKAT · Staff",
  robots: { index: false, follow: false },
  // The address carries the waiters' secret for a moment: never send it to other sites.
  referrer: "no-referrer",
};

/** Where the waiters' QR leads (Admin → QR): signs this device in to the waiter screen. */
export default function StaffJoinPage() {
  return <WaiterJoinScreen />;
}
