import { TableLanding } from "@/features/dine-in/table-landing";
import { PageHeader } from "@/components/layout/page-header";

/** A table's QR code: /t/inside-4 → remembers the table and opens the menu ("At the table" at checkout). */
export default async function TablePage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  return (
    <>
      <PageHeader />
      <TableLanding tableId={decodeURIComponent(tableId)} />
    </>
  );
}
