type Row = Record<string, unknown>;

function text(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function auditAuthorName(log: Row, users: Row[]) {
  const recordedName = text(log, ["usuario_nome", "user_name", "actor_name", "author_name"]);
  if (recordedName) return recordedName;
  const id = text(log, ["usuario_id", "user_id", "actor_id"]);
  const email = text(log, ["actor_email", "user_email"]);
  if (!id || id === "0") return email || "Sistema";
  const company = text(log, ["company_id"]);
  const pharmacy = text(log, ["pharmacy_id"]);
  // SQLite user IDs repeat between branches; never resolve one without both tenant keys.
  const user = company && pharmacy ? users.find((candidate) =>
    text(candidate, ["company_id"]) === company && text(candidate, ["pharmacy_id"]) === pharmacy &&
    [candidate.local_user_id, candidate.id].some((value) => value !== undefined && value !== null && String(value).trim() === id)
  ) : undefined;
  return user ? text(user, ["nome", "username", "email"]) || "Utilizador sem nome" : email || "Utilizador não sincronizado";
}
