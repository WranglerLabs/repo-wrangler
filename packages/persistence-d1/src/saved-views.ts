/** FR-012 saved views: instance-scoped, serializable filter sets. */
export interface SavedViewRow {
  id: string;
  name: string;
  definition: string;
  created_at: string;
}

export async function listSavedViews(db: D1Database): Promise<SavedViewRow[]> {
  const result = await db
    .prepare(`SELECT id, name, definition, created_at FROM saved_views ORDER BY name`)
    .all<SavedViewRow>();
  return result.results;
}

export async function createSavedView(
  db: D1Database,
  name: string,
  definition: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO saved_views (id, name, definition) VALUES (?1, ?2, ?3)`)
    .bind(id, name, definition)
    .run();
  return id;
}

export async function deleteSavedView(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM saved_views WHERE id = ?1`).bind(id).run();
}
