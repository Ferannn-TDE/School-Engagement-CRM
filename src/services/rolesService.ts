import { supabase } from './supabase';

// Roles (db/023): admin, editor, viewer. The database enforces them; these calls read
// them and let an admin change them. Every change is logged by the database itself.

export type Role = 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  userId: string;
  email?: string;
  role: Role;
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
}

export interface RoleChange {
  id: number;
  changedAt: string;
  changedByEmail?: string;
  userId: string;
  email?: string;
  oldRole?: Role;
  newRole: Role;
  oldArchived?: boolean;
  newArchived: boolean;
}

/** The signed-in account's role, from the database. */
export async function fetchMyRole(): Promise<Role> {
  const { data, error } = await supabase.rpc('app_role');
  if (error) throw error;
  return (data as Role) ?? 'viewer';
}

/** Before 023 is applied, app_role doesn't exist yet. */
export function isRolesMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === 'PGRST202' || /could not find the function public\.app_role/i.test(e?.message ?? '');
}

export async function fetchTeam(): Promise<TeamMember[]> {
  const { data, error } = await supabase.from('user_roles').select('*').order('email');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email ?? undefined,
    role: r.role,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? undefined,
    updatedBy: r.updated_by ?? undefined,
    archived: r.archived,
    archivedAt: r.archived_at ?? undefined,
    archivedBy: r.archived_by ?? undefined,
  }));
}

export async function fetchRoleChanges(limit = 100): Promise<RoleChange[]> {
  const { data, error } = await supabase
    .from('role_changes')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.change_id,
    changedAt: r.changed_at,
    changedByEmail: r.changed_by_email ?? undefined,
    userId: r.user_id,
    email: r.email ?? undefined,
    oldRole: r.old_role ?? undefined,
    newRole: r.new_role,
    oldArchived: r.old_archived ?? undefined,
    newArchived: r.new_archived,
  }));
}

async function updateMember(userId: string, values: { role?: Role; archived?: boolean }): Promise<void> {
  const { data, error } = await supabase.from('user_roles').update(values).eq('user_id', userId).select('user_id');
  if (error) throw error;
  if (!data?.length) throw new Error('Only admins can change roles');
}

export const setMemberRole = (userId: string, role: Role) => updateMember(userId, { role });
/** "Remove from team": the account counts as a viewer until added back. */
export const setMemberArchived = (userId: string, archived: boolean) => updateMember(userId, { archived });
