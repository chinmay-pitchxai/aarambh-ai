export const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
} as const;

export type Role = keyof typeof ROLE_HIERARCHY;

export const ROLE_PERMISSIONS: Record<Role, {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canManageBilling: boolean;
  canManageIntegrations: boolean;
  canRunPipeline: boolean;
}> = {
  owner: {
    canRead: true,
    canWrite: true,
    canDelete: true,
    canManageMembers: true,
    canManageBilling: true,
    canManageIntegrations: true,
    canRunPipeline: true,
  },
  admin: {
    canRead: true,
    canWrite: true,
    canDelete: true,
    canManageMembers: true,
    canManageBilling: false,
    canManageIntegrations: true,
    canRunPipeline: true,
  },
  member: {
    canRead: true,
    canWrite: true,
    canDelete: false,
    canManageMembers: false,
    canManageBilling: false,
    canManageIntegrations: false,
    canRunPipeline: true,
  },
  viewer: {
    canRead: true,
    canWrite: false,
    canDelete: false,
    canManageMembers: false,
    canManageBilling: false,
    canManageIntegrations: false,
    canRunPipeline: false,
  },
};

export function hasPermission(role: string, permission: keyof typeof ROLE_PERMISSIONS["owner"]): boolean {
  const roleLevel: number = ROLE_HIERARCHY[role as Role] ?? 0;
  if (roleLevel === 0) return false;

  const effectiveRole: Role = roleLevel >= 4 ? "owner" : roleLevel >= 3 ? "admin" : roleLevel >= 2 ? "member" : "viewer";
  return ROLE_PERMISSIONS[effectiveRole][permission];
}

export function isAtLeast(role: string, minimumRole: Role): boolean {
  const roleLevel: number = ROLE_HIERARCHY[role as Role] ?? 0;
  return roleLevel >= ROLE_HIERARCHY[minimumRole];
}
