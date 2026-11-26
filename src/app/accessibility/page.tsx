import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { InfoPageView } from "@/features/info-pages/info-page-view";

export const metadata: Metadata = { title: "MISHKAT · Accessibility" };

export default function InfoPage() {
  return (
    <>
      <PageHeader />
      <InfoPageView id="accessibility" />
    </>
  );
}
