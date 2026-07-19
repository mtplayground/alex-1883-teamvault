export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProjectInput {
  workspaceId: string;
  name: string;
  description?: string | null;
}

export function normalizeProjectName(name: string): string {
  const normalized = name.trim();

  if (normalized.length === 0) {
    throw new Error('project name is required');
  }

  return normalized;
}

export function normalizeProjectDescription(
  description: string | null | undefined,
): string | null {
  if (description === null || description === undefined) {
    return null;
  }

  const normalized = description.trim();
  return normalized.length > 0 ? normalized : null;
}
