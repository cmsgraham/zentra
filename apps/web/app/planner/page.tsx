'use client';

import AuthShell from '@/components/layout/AuthShell';
import PlannerView from '@/components/planner/PlannerView';

export default function GlobalPlannerPage() {
  return (
    <AuthShell>
      <PlannerView />
    </AuthShell>
  );
}
