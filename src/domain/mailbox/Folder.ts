export const FOLDERS = [
  "inbox",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
] as const;

export type Folder = (typeof FOLDERS)[number];

export function isFolder(value: string): value is Folder {
  return (FOLDERS as readonly string[]).includes(value);
}
