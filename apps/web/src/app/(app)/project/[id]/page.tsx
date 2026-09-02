import { ProjectView } from "@/components/editor/project-view";

export default async function ProjectPage({ params }: PageProps<"/project/[id]">) {
  const { id } = await params;
  return <ProjectView id={id} />;
}
