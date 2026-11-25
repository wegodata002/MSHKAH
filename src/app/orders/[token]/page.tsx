import { OrderTrackingScreen } from "@/features/orders/order-tracking-screen";
import { PageHeader } from "@/components/layout/page-header";

/** Customer order tracking: /orders/<tracking token> (link after ordering, in the email, or found by number + phone). */
export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <PageHeader />
      <OrderTrackingScreen token={decodeURIComponent(token)} />
    </>
  );
}
