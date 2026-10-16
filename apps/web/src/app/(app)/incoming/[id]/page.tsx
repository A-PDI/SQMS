import { IncomingEditor } from "@/components/operations/incoming";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncomingEditor id={id} />;
}
