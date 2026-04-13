const STORAGE_PREFIX = 'siue_crm_';

export function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}


export function exportDatabase(): string {
  // activities are now in Supabase and no longer stored in localStorage
  const keys = ['schools', 'contacts', 'events'];
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw) data[key] = JSON.parse(raw);
  }
  return JSON.stringify(data, null, 2);
}

export function importDatabase(json: string): boolean {
  try {
    const data = JSON.parse(json);
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    }
    return true;
  } catch {
    return false;
  }
}
