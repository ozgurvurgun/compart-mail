import { useEffect, useState } from "react";
import type { Attachment } from "./api";

type Kind = "image" | "pdf" | "video" | "audio" | "text" | null;

export function previewKind(file: { contentType: string; filename: string }): Kind {
  const type = (file.contentType || "").toLowerCase();
  const ext = file.filename.split(".").pop()?.toLowerCase() || "";
  if (type === "image/svg+xml" || ext === "svg") return null;
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) {
    return "image";
  }
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.startsWith("video/") || ["mp4", "webm"].includes(ext)) return "video";
  if (type.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(ext)) return "audio";
  if ((type.startsWith("text/") && type !== "text/html") || ["txt", "csv", "md", "json"].includes(ext)) {
    return "text";
  }
  return null;
}

function src(id: string) {
  return `/api/attachments/${id}`;
}

function downloadHref(id: string) {
  return `/api/attachments/${id}?download=1`;
}

export function AttachmentGallery({ files }: { files: Attachment[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = files.find((file) => file.id === openId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-3">
        {files.map((file) => {
          const kind = previewKind(file);
          if (kind === "image") {
            return (
              <button
                key={file.id}
                type="button"
                onClick={() => setOpenId(file.id)}
                className="group w-44 overflow-hidden rounded-[12px] bg-[var(--fill)] text-left"
              >
                <img
                  src={src(file.id)}
                  alt=""
                  className="h-28 w-full object-cover"
                />
                <span className="block truncate px-2.5 py-2 text-[11px] text-muted group-hover:text-ink">
                  {file.filename}
                </span>
              </button>
            );
          }
          return kind ? (
            <button
              key={file.id}
              type="button"
              onClick={() => setOpenId(file.id)}
              className="flex min-w-40 max-w-56 items-center gap-2 rounded-[12px] bg-[var(--fill)] px-3 py-2.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{file.filename}</span>
              <span className="shrink-0 font-mono text-[10px] uppercase text-muted">{kind}</span>
            </button>
          ) : (
            <a
              key={file.id}
              href={downloadHref(file.id)}
              className="flex min-w-40 max-w-56 items-center rounded-[12px] bg-[var(--fill)] px-3 py-2.5 text-[13px] text-accent"
            >
              <span className="truncate">{file.filename}</span>
            </a>
          );
        })}
      </div>
      {open ? (
        <PreviewLayer file={open} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function PreviewLayer({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const kind = previewKind(file);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "text") return;
    fetch(src(file.id), { credentials: "include" })
      .then((response) => response.text())
      .then(setText)
      .catch(() => setText("Could not load file"));
  }, [file.id, kind]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/35 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[14px] bg-surface shadow-[var(--shadow)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2 shadow-[inset_0_-0.5px_0_var(--color-line)]">
          <p className="truncate text-[15px] font-semibold text-ink">{file.filename}</p>
          <div className="flex items-center gap-1">
            <a href={downloadHref(file.id)} className="btn-icon" aria-label="Download">
              <DownloadIcon />
            </a>
            <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
              <XIcon />
            </button>
          </div>
        </div>
        <div className="mail-scroll min-h-0 flex-1 overflow-auto p-4">
          {kind === "image" ? (
            <img src={src(file.id)} alt={file.filename} className="mx-auto max-h-[75vh] max-w-full rounded-lg object-contain" />
          ) : null}
          {kind === "pdf" ? (
            <iframe title={file.filename} src={src(file.id)} className="h-[75vh] w-full rounded-lg bg-canvas" />
          ) : null}
          {kind === "video" ? (
            <video src={src(file.id)} controls className="mx-auto max-h-[75vh] max-w-full rounded-lg" />
          ) : null}
          {kind === "audio" ? <audio src={src(file.id)} controls className="w-full" /> : null}
          {kind === "text" ? (
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{text ?? "Loading"}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path d="M8 3v7M5 8l3 3 3-3M3.5 13h9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
