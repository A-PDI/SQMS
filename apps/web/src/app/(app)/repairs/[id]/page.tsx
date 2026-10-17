import { RepairDetail } from "@/components/operations/injectors";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RepairDetail id={id} />;
}
