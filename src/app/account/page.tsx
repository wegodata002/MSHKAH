import { PageHeader } from "@/components/layout/page-header";
import { AccountScreen } from "@/features/account/account-screen";

/** The person icon in the header: club, my orders, favourites, contact details (no admin links). */
export default function AccountPage() {
  return (
    <>
      <PageHeader />
      <AccountScreen />
    </>
  );
}
