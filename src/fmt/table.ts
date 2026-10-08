const MISSING = "-";

function lookup(record: unknown, field: string): unknown {
  return field
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current !== null && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      record
    );
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return MISSING;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function label(field: string): string {
  return field.replace(/[._]/g, " ").toUpperCase();
}

export function rowsOf(body: unknown, key = "data"): unknown[] {
  if (Array.isArray(body)) return body;
  if (body !== null && typeof body === "object") {
    const rows = (body as Record<string, unknown>)[key];
    if (Array.isArray(rows)) return rows;
  }
  return [body];
}

export function renderTable(columns: string[], rows: unknown[]): string {
  const grid = [
    columns.map(label),
    ...rows.map((row) => columns.map((field) => cell(lookup(row, field)))),
  ];
  const widths = columns.map((_field, index) =>
    Math.max(...grid.map((line) => line[index]!.length))
  );
  return grid
    .map((line) =>
      line
        .map((value, index) => value.padEnd(widths[index]!))
        .join("  ")
        .trimEnd()
    )
    .map((line) => `${line}\n`)
    .join("");
}
