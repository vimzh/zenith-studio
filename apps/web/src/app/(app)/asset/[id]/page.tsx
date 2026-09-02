import { AssetEditor } from "@/components/editor/asset-editor";

export default async function AssetPage({ params }: PageProps<"/asset/[id]">) {
  const { id } = await params;
  return <AssetEditor id={id} />;
}
