import AuthShell from '@/components/layout/AuthShell';
import { HuddlesListView } from '@/components/huddles/HuddlesListView';

export default function HuddlesPage() {
  return (
    <AuthShell>
      <HuddlesListView />
    </AuthShell>
  );
}
