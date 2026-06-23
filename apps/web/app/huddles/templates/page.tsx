import AuthShell from '@/components/layout/AuthShell';
import { HuddleTemplatesView } from '@/components/huddles/HuddleTemplatesView';

export default function HuddleTemplatesPage() {
  return (
    <AuthShell>
      <HuddleTemplatesView />
    </AuthShell>
  );
}
