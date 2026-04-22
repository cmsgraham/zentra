import AuthShell from '@/components/layout/AuthShell';
import { TodayView } from '@/components/zentra/TodayView';

export default function TodayPage() {
  return (
    <AuthShell>
      <TodayView />
    </AuthShell>
  );
}
