import { HuddleShareView } from '@/components/huddles/HuddleShareView';

export default async function HuddleSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <HuddleShareView token={token} />;
}
