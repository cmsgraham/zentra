import AuthShell from '@/components/layout/AuthShell';
import { HuddleSeriesReportView } from '@/components/huddles/HuddleSeriesReportView';

export default async function HuddleSeriesReportPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return (
    <AuthShell>
      <HuddleSeriesReportView templateId={templateId} />
    </AuthShell>
  );
}
