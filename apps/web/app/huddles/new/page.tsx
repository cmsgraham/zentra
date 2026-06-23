import AuthShell from '@/components/layout/AuthShell';
import { StartHuddleView } from '@/components/huddles/StartHuddleView';

export default function StartHuddlePage() {
  return (
    <AuthShell>
      <StartHuddleView />
    </AuthShell>
  );
}
