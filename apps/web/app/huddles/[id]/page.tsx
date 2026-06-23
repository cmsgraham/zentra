import AuthShell from '@/components/layout/AuthShell';
import { HuddleDetailView } from '@/components/huddles/HuddleDetailView';

export default async function HuddleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AuthShell>
      <HuddleDetailView huddleId={id} />
    </AuthShell>
  );
}
