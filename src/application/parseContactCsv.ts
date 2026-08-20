import type { AddressHeader } from "../domain/message/Message";

export function parseContactCsv(raw: string): AddressHeader[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const table = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  if (table.length === 0) return [];

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const mapped = headerLooksLikeNames(header);
  const rows = mapped ? table.slice(1) : table;
  const index = mapped ? columnIndex(header) : { email: 0, name: 1, first: -1, last: -1 };

  const people: AddressHeader[] = [];
  for (const row of rows.slice(0, 2000)) {
    const email = (row[index.email] || "").trim();
    if (!email) continue;
    const name =
      (row[index.name] || "").trim() ||
      [row[index.first] || "", row[index.last] || ""].join(" ").trim();
    people.push({ address: email, name });
  }
  return people;
}

function headerLooksLikeNames(header: string[]) {
  return header.some((cell) =>
    ["email", "e-mail", "mail", "name", "full name", "firstname", "first name", "lastname", "last name"].includes(
      cell,
    ),
  );
}

function columnIndex(header: string[]) {
  return {
    email: findCol(header, ["email", "e-mail", "mail", "e_mail", "e-posta", "eposta"]),
    name: findCol(header, ["name", "full name", "fullname", "display name", "ad", "isim", "ad soyad"]),
    first: findCol(header, ["first", "firstname", "first name", "given name"]),
    last: findCol(header, ["last", "lastname", "last name", "surname", "family name"]),
  };
}

function findCol(header: string[], names: string[]) {
  const index = header.findIndex((cell) => names.includes(cell));
  return index;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
