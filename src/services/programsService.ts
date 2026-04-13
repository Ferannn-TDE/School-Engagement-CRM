import { supabase } from './supabase';
import type { Program, ProgramCategory } from '../types';
import { nowISO } from '../utils/helpers';

interface ProgramRow {
  program_id: string;
  school_id: string;
  name: string;
  category: string;
  description: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

function rowToProgram(row: ProgramRow): Program {
  return {
    id: row.program_id,
    schoolId: row.school_id,
    name: row.name,
    category: row.category as ProgramCategory,
    description: row.description ?? undefined,
    isActive: row.is_active ?? true,
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? nowISO(),
  };
}

export async function fetchPrograms(): Promise<Program[]> {
  const { data, error } = await supabase.from('programs').select('*');
  if (error) throw error;
  return (data as ProgramRow[]).map(rowToProgram);
}

export async function createProgram(
  program: Omit<Program, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Program> {
  const { data, error } = await supabase
    .from('programs')
    .insert({
      school_id: program.schoolId,
      name: program.name,
      category: program.category,
      description: program.description ?? null,
      is_active: program.isActive,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToProgram(data as ProgramRow);
}

export async function updateProgram(id: string, updates: Partial<Program>): Promise<void> {
  const patch: Partial<ProgramRow> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.category !== undefined) patch.category = updates.category;
  if (updates.description !== undefined) patch.description = updates.description ?? null;
  if (updates.isActive !== undefined) patch.is_active = updates.isActive;
  const { error } = await supabase.from('programs').update(patch).eq('program_id', id);
  if (error) throw error;
}

export async function deleteProgram(id: string): Promise<void> {
  const { error } = await supabase.from('programs').delete().eq('program_id', id);
  if (error) throw error;
}
