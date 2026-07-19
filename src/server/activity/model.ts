export const activityActions = [
  'user_joined',
  'invitation_sent',
  'invitation_accepted',
  'project_created',
  'document_uploaded',
  'document_shared',
] as const;

export type ActivityAction = (typeof activityActions)[number];

export interface ActivityEntry {
  id: string;
  actorSub: string;
  action: ActivityAction;
  workspaceId: string | null;
  projectId: string | null;
  documentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface NewActivityEntryInput {
  actorSub: string;
  action: ActivityAction;
  workspaceId?: string | null;
  projectId?: string | null;
  documentId?: string | null;
  metadata?: Record<string, unknown>;
}

export function parseActivityAction(value: string): ActivityAction {
  if (activityActions.includes(value as ActivityAction)) {
    return value as ActivityAction;
  }

  throw new Error(`Unsupported activity action: ${value}`);
}
