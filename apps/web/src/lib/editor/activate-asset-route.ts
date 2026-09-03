// Route-owned activation waits for both persisted stores and never requests navigation.
import { hydrateProjects, projects } from "./projects";
import { session } from "./session";

export async function activateAssetRoute(id: string, isCurrent: () => boolean): Promise<boolean> {
  await Promise.all([session.hydrate(), hydrateProjects()]);
  if (!isCurrent() || !session.has(id)) return false;

  const { projectId } = projects.placementOf(id);
  // An asset in the same project must not reset the user's selected folder.
  // A loose asset must not inherit some other game's generation/export context.
  if (projects.activeProjectId !== projectId && !projects.openProject(projectId)) {
    throw new Error(`Asset '${id}' belongs to missing project '${projectId}'. Its project context could not be restored.`);
  }
  return session.open(id);
}
