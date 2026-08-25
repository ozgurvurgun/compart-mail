import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_MAILBOX,
  api,
  displayName,
  formatWhen,
  mailboxAddress,
  ApiError,
  type MessageDetail,
  type MessageListItem,
  type Session,
} from "./api";
import { AttachmentGallery } from "./AttachmentGallery";
import { ConfirmDialog } from "./ConfirmDialog";
import DOMPurify from "dompurify";
import { AccessProblem } from "./AccessProblem";
import { currentOrigin, signOutOfAccess } from "./access";
import { CompartSeal } from "./CompartSeal";
import { ProfileMenu } from "./ProfileMenu";
import { Logo, bootAppName } from "./Logo";
import { MenuSelect } from "./MenuSelect";
import { CheckBox } from "./CheckBox";
import { ContactsPage } from "./ContactsPage";
import { TemplatesPage } from "./TemplatesPage";
import { AddressField } from "./AddressField";
import { useTheme, setSidebarChrome, type Theme } from "./theme";
import type { EmailTemplate } from "./api";

const FOLDERS = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "starred", label: "Starred", icon: StarIcon },
  { id: "sent", label: "Sent", icon: SentIcon },
  { id: "drafts", label: "Drafts", icon: DraftIcon },
  { id: "archive", label: "Archive", icon: ArchiveIcon },
  { id: "spam", label: "Spam", icon: SpamIcon },
  { id: "trash", label: "Trash", icon: TrashIcon },
] as const;

type FolderId = (typeof FOLDERS)[number]["id"];
type Pending =
  | { kind: "trash"; ids: string[] }
  | { kind: "purge"; ids: string[] }
  | null;

const MAILBOX_KEY = "compart-mailbox";

function readSavedMailbox() {
  try {
    return localStorage.getItem(MAILBOX_KEY) || "";
  } catch {
    return "";
  }
}

function pickMailbox(mailboxes: Array<{ address: string }>, preferred = readSavedMailbox()) {
  if (preferred === ALL_MAILBOX) return ALL_MAILBOX;
  if (preferred && mailboxes.some((box) => box.address === preferred)) return preferred;
  return mailboxes[0]?.address || "";
}

function composeMailbox(mailbox: string, mailboxes: Array<{ address: string }>) {
  if (mailbox !== ALL_MAILBOX && mailboxes.some((box) => box.address === mailbox)) return mailbox;
  return mailboxes[0]?.address || "";
}

function listCacheKey(mailbox: string, folder: string, q: string) {
  return `${mailbox}|${folder}|${q.trim()}`;
}

function previewDetail(item: MessageListItem): MessageDetail {
  return {
    ...item,
    cc: [],
    bcc: [],
    html: "",
    text: "",
    threadId: "",
    internetMessageId: "",
  };
}

export function App() {
  const { density } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [accessState, setAccessState] = useState<"ok" | "denied" | "misconfigured">("ok");
  const [loading, setLoading] = useState(true);
  const [mailbox, setMailbox] = useState("");
  const [folder, setFolder] = useState<FolderId>("inbox");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MessageListItem[]>([]);
  const [listReady, setListReady] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const listCache = useRef(new Map<string, MessageListItem[]>());
  const refreshSeq = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [bodyPending, setBodyPending] = useState(false);
  const detailCache = useRef(new Map<string, MessageDetail>());
  const detailSeq = useRef(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [reply, setReply] = useState<MessageDetail | null>(null);
  const [editingDraft, setEditingDraft] = useState<MessageDetail | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templatesQ, setTemplatesQ] = useState("");
  const [composeSeed, setComposeSeed] = useState<{ subject: string; html: string } | null>(null);
  const [peopleQ, setPeopleQ] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setSidebarChrome(drawerOpen);
    return () => setSidebarChrome(false);
  }, [drawerOpen]);

  useEffect(() => {
    api<Session>("/api/session")
      .then((data) => {
        setSession(data);
        setMailbox(pickMailbox(data.mailboxes));
        setAccessState("ok");
        document.title = data.appName;
        window.__MAIL_APP_NAME__ = data.appName;
      })
      .catch((err) => {
        setSession(null);
        if (err instanceof ApiError && err.status === 503) setAccessState("misconfigured");
        else setAccessState("denied");
      })
      .finally(() => setLoading(false));
  }, []);

  function showCachedOrWait(nextMailbox: string, nextFolder: string, nextQ: string) {
    const cached = listCache.current.get(listCacheKey(nextMailbox, nextFolder, nextQ));
    if (cached) {
      setItems(cached);
      setListReady(true);
      setPicked((prev) => prev.filter((id) => cached.some((item) => item.id === id)));
      return;
    }
    setItems([]);
    setListReady(false);
    setPicked([]);
  }

  async function refresh(nextMailbox = mailbox, nextFolder = folder, nextQ = q) {
    if (!nextMailbox) return;
    const seq = ++refreshSeq.current;
    const key = listCacheKey(nextMailbox, nextFolder, nextQ);
    const data = await api<{
      items: MessageListItem[];
      counts: Record<string, number>;
    }>(
      `/api/messages?mailbox=${encodeURIComponent(nextMailbox)}&folder=${nextFolder}&q=${encodeURIComponent(nextQ)}`,
    );
    if (seq !== refreshSeq.current) return;
    listCache.current.set(key, data.items);
    setItems(data.items);
    setCounts(data.counts);
    setListReady(true);
    setPicked((prev) => prev.filter((id) => data.items.some((item) => item.id === id)));
  }

  useEffect(() => {
    if (!mailbox) return;
    try {
      localStorage.setItem(MAILBOX_KEY, mailbox);
    } catch {
    }
  }, [mailbox]);

  useEffect(() => {
    if (!mailbox) return;
    showCachedOrWait(mailbox, folder, q);
    void refresh();
  }, [mailbox, folder]);

  const skipQRefresh = useRef(true);
  useEffect(() => {
    if (skipQRefresh.current) {
      skipQRefresh.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      showCachedOrWait(mailbox, folder, q);
      void refresh();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setBodyPending(false);
      return;
    }
    const cached = detailCache.current.get(selectedId);
    if (cached) {
      setDetail(cached);
      setBodyPending(false);
    }
    const seq = ++detailSeq.current;
    void api<MessageDetail>(`/api/messages/${selectedId}`).then((message) => {
      if (seq !== detailSeq.current) return;
      detailCache.current.set(selectedId, message);
      setDetail(message);
      setBodyPending(false);
    });
  }, [selectedId]);

  const composeDefaults = useMemo(() => {
    if (editingDraft) {
      const draftHtml = (editingDraft.html || "").trim();
      const useHtml =
        Boolean(draftHtml) &&
        !/^<pre[\s>]/i.test(draftHtml) &&
        /<(html|div|table|p|body)\b/i.test(draftHtml);
      return {
        to: editingDraft.to.map((item) => item.address).join(", "),
        cc: (editingDraft.cc ?? []).map((item) => item.address).join(", "),
        bcc: (editingDraft.bcc ?? []).map((item) => item.address).join(", "),
        subject: editingDraft.subject,
        text: useHtml ? "" : editingDraft.text,
        html: useHtml ? draftHtml : "",
      };
    }
    if (composeSeed) {
      return {
        to: composeTo,
        cc: "",
        bcc: "",
        subject: composeSeed.subject,
        text: "",
        html: composeSeed.html,
      };
    }
    if (!reply) {
      return { to: composeTo, cc: "", bcc: "", subject: "", text: "", html: "" };
    }
    return {
      to: reply.from.address,
      cc: "",
      bcc: "",
      subject: reply.subject.startsWith("Re:") ? reply.subject : `Re: ${reply.subject}`,
      text: "",
      html: "",
    };
  }, [reply, editingDraft, composeTo, composeSeed]);

  function openCompose(nextReply: MessageDetail | null = null) {
    setReply(nextReply);
    setEditingDraft(null);
    setComposeTo("");
    setComposeSeed(null);
    setComposeOpen(true);
  }

  function openComposeTo(emails: string[]) {
    setReply(null);
    setEditingDraft(null);
    setComposeTo(emails.slice(0, 80).join(", "));
    setComposeSeed(null);
    setPeopleOpen(false);
    setTemplatesOpen(false);
    setComposeOpen(true);
  }

  function openComposeWithTemplate(template: EmailTemplate) {
    setReply(null);
    setEditingDraft(null);
    setComposeTo("");
    setComposeSeed({ subject: template.subject, html: template.html });
    setPeopleOpen(false);
    setTemplatesOpen(false);
    setComposeOpen(true);
  }

  function openDraft(message: MessageDetail) {
    setReply(null);
    setEditingDraft(message);
    setComposeTo("");
    setComposeSeed(null);
    setComposeOpen(true);
  }

  function closeCompose() {
    setComposeOpen(false);
    setReply(null);
    setEditingDraft(null);
    setComposeTo("");
    setComposeSeed(null);
  }

  function signOut() {
    setSession(null);
    setPending(null);
    signOutOfAccess(`${currentOrigin()}/`);
  }

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-canvas">
        <div className="flex flex-col items-center gap-5">
          <div className="spinner" />
          <Logo name={bootAppName()} />
          <p className="text-[13px] text-muted">Checking Cloudflare Access…</p>
        </div>
      </div>
    );
  }

  if (accessState !== "ok" || !session) {
    return <AccessProblem misconfigured={accessState === "misconfigured"} />;
  }

  const currentFolder = FOLDERS.find((item) => item.id === folder);

  return (
    <div className="flex h-full flex-col overflow-x-hidden bg-canvas pt-[env(safe-area-inset-top)]">
      <header className="hairline grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 bg-surface px-2 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            className="btn-icon lg:hidden"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>
          <Logo name={session.appName} />
          <span className="sr-only">{session.appName}</span>
        </div>
        <form
          className="mx-auto w-full max-w-[28rem]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!peopleOpen && !templatesOpen) void refresh();
          }}
        >
          <div className="relative">
            <SearchMark />
            <input
              value={templatesOpen ? templatesQ : peopleOpen ? peopleQ : q}
              onChange={(event) =>
                templatesOpen
                  ? setTemplatesQ(event.target.value)
                  : peopleOpen
                    ? setPeopleQ(event.target.value)
                    : setQ(event.target.value)
              }
              placeholder="Search"
              aria-label={
                templatesOpen ? "Search templates" : peopleOpen ? "Search people" : "Search mail"
              }
              className="ios-search"
            />
            {(!peopleOpen && !templatesOpen && q) ||
            (peopleOpen && peopleQ) ||
            (templatesOpen && templatesQ) ? (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted"
                onClick={() =>
                  templatesOpen ? setTemplatesQ("") : peopleOpen ? setPeopleQ("") : setQ("")
                }
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </form>
        <ProfileMenu
          name={session.identity.name || "Studio"}
          email={session.identity.email}
          onSignOut={() => void signOut()}
        />
      </header>

      <div className="flex min-h-0 flex-1 bg-surface pb-8 lg:bg-transparent lg:pb-0">
        <aside
          className={`flex min-h-0 flex-col overflow-visible bg-[var(--sidebar)] shadow-[inset_-0.5px_0_0_var(--color-line)] lg:flex lg:w-56 lg:shrink-0 ${
            drawerOpen
              ? "max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:w-full max-lg:pt-[env(safe-area-inset-top)]"
              : "hidden"
          }`}
        >
          <div className="flex items-center justify-between px-3 pt-2 lg:hidden">
            <p className="text-[17px] font-semibold tracking-[-0.03em]">Mailboxes</p>
            <button type="button" className="btn-ghost px-2 text-[17px]" onClick={() => setDrawerOpen(false)}>
              Done
            </button>
          </div>
          <div className="min-w-0 p-3">
            <button
              type="button"
              onClick={() => {
                openCompose();
                setDrawerOpen(false);
              }}
              className="btn-accent w-full rounded-full py-2 text-[15px]"
            >
              <ComposeIcon />
              New Message
            </button>
            <p className="mt-5 mb-1.5 px-2 text-[11px] font-semibold tracking-[0.04em] text-muted uppercase">
              Mailboxes
            </p>
            <MenuSelect
              value={mailbox}
              onChange={(value) => {
                setMailbox(value);
                setSelectedId(null);
                setPicked([]);
                setDrawerOpen(false);
              }}
              options={[
                { value: ALL_MAILBOX, label: "All", hint: session.domain },
                ...session.mailboxes.map((box) => ({
                  value: box.address,
                  label: box.displayName || box.address.split("@")[0],
                  hint: box.address,
                })),
              ]}
            />
          </div>
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
            {FOLDERS.map((item) => {
              const unread =
                item.id === "starred" ? counts["starred:total"] : counts[`${item.id}:unread`];
              const active = !peopleOpen && !templatesOpen && folder === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setFolder(item.id);
                    setPeopleOpen(false);
                    setTemplatesOpen(false);
                    setSelectedId(null);
                    setPicked([]);
                    setDrawerOpen(false);
                  }}
                  className={`source-item ${active ? "active" : ""}`}
                >
                  <Icon />
                  <span className="flex-1 text-left">{item.label}</span>
                  {unread ? <span className="count">{unread}</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setPeopleOpen(true);
                setTemplatesOpen(false);
                setSelectedId(null);
                setPicked([]);
                setDrawerOpen(false);
              }}
              className={`source-item ${peopleOpen ? "active" : ""}`}
            >
              <PeopleIcon />
              <span className="flex-1 text-left">Contacts</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTemplatesOpen(true);
                setPeopleOpen(false);
                setSelectedId(null);
                setPicked([]);
                setDrawerOpen(false);
              }}
              className={`source-item ${templatesOpen ? "active" : ""}`}
            >
              <TemplateIcon />
              <span className="flex-1 text-left">Templates</span>
            </button>
          </nav>
          {/^compart/i.test(session.appName) ? (
            <div className="mailbox-seal-bar mt-auto shrink-0 overflow-visible border-t border-[color:var(--color-line)] px-3 pt-3 pb-2 lg:pb-4">
              <div className="flex justify-center">
                <CompartSeal />
              </div>
            </div>
          ) : null}
        </aside>

        {peopleOpen ? (
          <ContactsPage q={peopleQ} onCompose={openComposeTo} />
        ) : templatesOpen ? (
          <TemplatesPage q={templatesQ} onUse={openComposeWithTemplate} />
        ) : (
          <>
        <section className={`flex min-w-0 flex-col bg-surface shadow-[inset_-0.5px_0_0_var(--color-line)] lg:w-[23rem] lg:shrink-0 ${
          selectedId ? "max-lg:hidden" : "flex-1 lg:flex-none"
        }`}>
          <div className="flex h-11 shrink-0 items-center gap-3 px-3">
            <CheckBox
              checked={items.length > 0 && picked.length === items.length}
              mixed={picked.length > 0 && picked.length < items.length}
              disabled={items.length === 0}
              label="Select all"
              onChange={(next) => setPicked(next ? items.map((item) => item.id) : [])}
            />
            {picked.length > 0 ? (
              <>
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                  {picked.length} Selected
                </p>
                <div className="flex shrink-0 items-center">
                  {folder === "inbox" ? (
                    <Action
                      label="Archive"
                      icon={<ArchiveIcon />}
                      onClick={async () => {
                        await api("/api/messages/batch", {
                          method: "POST",
                          body: JSON.stringify({ ids: picked, folder: "archive" }),
                        });
                        if (selectedId && picked.includes(selectedId)) setSelectedId(null);
                        setPicked([]);
                        void refresh();
                      }}
                    />
                  ) : null}
                  {folder === "trash" ? (
                    <Action
                      label="Delete forever"
                      icon={<TrashIcon />}
                      onClick={() => setPending({ kind: "purge", ids: picked })}
                    />
                  ) : (
                    <Action
                      label="Trash"
                      icon={<TrashIcon />}
                      onClick={() => setPending({ kind: "trash", ids: picked })}
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.03em]">
                  {currentFolder?.label}
                </p>
                <span className="shrink-0 text-[13px] tabular-nums text-muted">
                  {listReady ? (q.trim() ? `${items.length} Found` : `${items.length}`) : ""}
                </span>
              </>
            )}
          </div>
          <div className="mail-scroll flex-1 overflow-y-auto pb-3">
            {!listReady ? (
              <div className="grid place-items-center px-5 py-20">
                <div className="spinner" />
              </div>
            ) : items.length === 0 ? (
              <div className="grid place-items-center px-5 py-20 text-center">
                <p className="text-[22px] font-semibold tracking-[-0.03em]">No Mail</p>
                <p className="mt-1 text-[15px] text-muted">No messages in {currentFolder?.label.toLowerCase()}.</p>
              </div>
            ) : (
              items.map((item) => {
                const active = item.id === selectedId;
                const checked = picked.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={`mail-row ${active ? "active" : ""}`}
                  >
                    <div className={`flex w-10 shrink-0 justify-center ${density === "compact" ? "pt-2" : "pt-2.5"}`}>
                      <CheckBox
                        checked={checked}
                        label={`Select ${displayName(item.from, { fromDisplayName: session.fromDisplayName, domain: session.domain })}`}
                        onChange={(next) => {
                          setPicked((prev) =>
                            next ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                          );
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const cached = detailCache.current.get(item.id);
                        setSelectedId(item.id);
                        if (item.unread) {
                          setItems((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, unread: false } : row)),
                          );
                        }
                        if (cached) {
                          setDetail(cached);
                          setBodyPending(false);
                        } else {
                          setDetail(previewDetail(item));
                          setBodyPending(true);
                        }
                        if (folder === "drafts") {
                          void api<MessageDetail>(`/api/messages/${item.id}`).then((message) => {
                            detailCache.current.set(item.id, message);
                            setDetail(message);
                            setBodyPending(false);
                            openDraft(message);
                          });
                        }
                      }}
                      className={`min-w-0 flex-1 pr-4 text-left ${
                        density === "compact" ? "py-1.5" : "py-2.5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`flex min-w-0 items-center gap-2 truncate text-[15px] ${item.unread ? "font-semibold text-ink" : "font-medium text-ink"}`}>
                          {item.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
                        {folder === "drafts"
                          ? item.to[0]
                            ? displayName(item.to[0])
                            : "No Recipient"
                          : displayName(item.from, { fromDisplayName: session.fromDisplayName, domain: session.domain })}
                          {mailbox === ALL_MAILBOX ? (
                            <span className="shrink-0 text-[12px] font-normal text-muted">
                              {mailboxAddress(item.mailbox).split("@")[0]}
                            </span>
                          ) : null}
                        </p>
                        <span className="shrink-0 text-[13px] tabular-nums text-muted">{formatWhen(item.dateMs)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[15px] text-ink">{item.subject || "No Subject"}</p>
                      <p className="mt-0.5 truncate text-[13px] text-muted">{item.snippet}</p>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className={`min-w-0 flex-1 flex-col bg-surface ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {selectedId && detail && detail.id === selectedId ? (
            <>
              <div className="flex shrink-0 items-center px-1 sm:px-2">
                <button
                  type="button"
                  className="btn-icon lg:hidden"
                  aria-label="Back to list"
                  onClick={() => setSelectedId(null)}
                >
                  <BackIcon />
                </button>
                <div className="flex min-w-0 flex-1 items-center justify-end overflow-x-auto">
                    <Action
                      label={detail.starred ? "Unstar" : "Star"}
                      icon={<StarIcon filled={detail.starred} className={detail.starred ? "text-[var(--color-star)]" : ""} />}
                      onClick={async () => {
                        await api(`/api/messages/${detail.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ starred: !detail.starred }),
                        });
                        setDetail({ ...detail, starred: !detail.starred });
                        void refresh();
                      }}
                    />
                    {detail.folder === "drafts" ? (
                      <Action
                        label="Edit draft"
                        icon={<ComposeIcon />}
                        onClick={() => openDraft(detail)}
                      />
                    ) : (
                      <Action label="Reply" icon={<ReplyIcon />} onClick={() => openCompose(detail)} />
                    )}
                    {detail.folder === "trash" || detail.folder === "spam" || detail.folder === "archive" ? (
                      <Action
                        label={detail.folder === "spam" ? "Not spam" : "Move to inbox"}
                        icon={<InboxIcon />}
                        onClick={async () => {
                          await api(`/api/messages/${detail.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ folder: "inbox" }),
                          });
                          setSelectedId(null);
                          void refresh();
                        }}
                      />
                    ) : null}
                    {detail.folder === "inbox" ? (
                      <Action
                        label="Archive"
                        icon={<ArchiveIcon />}
                        onClick={async () => {
                          await api(`/api/messages/${detail.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ folder: "archive" }),
                          });
                          setSelectedId(null);
                          void refresh();
                        }}
                      />
                    ) : null}
                    {detail.folder !== "spam" && detail.folder !== "trash" ? (
                      <Action
                        label="Report spam"
                        icon={<SpamIcon />}
                        onClick={async () => {
                          await api(`/api/messages/${detail.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ folder: "spam" }),
                          });
                          setSelectedId(null);
                          void refresh();
                        }}
                      />
                    ) : null}
                    <Action
                      label={detail.folder === "trash" ? "Delete forever" : "Trash"}
                      icon={<TrashIcon />}
                      onClick={() =>
                        setPending({
                          kind: detail.folder === "trash" ? "purge" : "trash",
                          ids: [detail.id],
                        })
                      }
                    />
                    <Action
                      label={detail.unread ? "Mark read" : "Mark unread"}
                      icon={detail.unread ? <MailOpenIcon /> : <MailIcon />}
                      onClick={async () => {
                        await api(`/api/messages/${detail.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ unread: !detail.unread }),
                        });
                        void refresh();
                      }}
                    />
                </div>
              </div>
              <div className="mail-scroll min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6">
                <h1 className="text-[22px] font-bold tracking-[-0.03em]">
                  {detail.subject || "No Subject"}
                </h1>
                <p className="mt-1.5 text-[15px] text-ink">
                  {displayName(detail.from, { fromDisplayName: session.fromDisplayName, domain: session.domain })}
                  <span className="text-muted"> · {detail.from.address}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  to {detail.to.map((item) => item.address).join(", ")} · {mailboxAddress(detail.mailbox)}
                </p>
                <div className="mt-5">
                  {bodyPending ? (
                    <div className="grid place-items-center py-16">
                      <div className="spinner" />
                    </div>
                  ) : (
                    <>
                      {detail.attachments?.length ? <AttachmentGallery files={detail.attachments} /> : null}
                      <MessageBody html={detail.html} text={detail.text} />
                    </>
                  )}
                </div>
              </div>
            </>
          ) : selectedId ? (
            <div className="grid flex-1 place-items-center">
              <div className="spinner" />
            </div>
          ) : (
            <div className="grid flex-1 place-items-center px-8 text-center">
              <div>
                <p className="text-[22px] font-semibold tracking-[-0.03em]">No Message Selected</p>
                <p className="mt-1 max-w-xs text-[15px] text-muted">Choose a message from the list, or write a new one.</p>
              </div>
            </div>
          )}
        </section>
          </>
        )}
      </div>

      <nav className="tab-bar fixed inset-x-0 z-20 grid grid-cols-4 items-end px-1 lg:hidden">
        <button
          type="button"
          className={`flex flex-col items-center gap-0 py-0 text-[9px] font-medium leading-none ${
            !peopleOpen && !templatesOpen ? "text-accent" : "text-muted"
          }`}
          onClick={() => {
            setPeopleOpen(false);
            setTemplatesOpen(false);
            setSelectedId(null);
          }}
        >
          <InboxIcon className="h-[18px] w-[18px]" />
          Mail
        </button>
        <button
          type="button"
          className="flex flex-col items-center gap-0 py-0 text-[9px] font-medium leading-none text-muted"
          onClick={() => openCompose()}
        >
          <ComposeIcon className="h-[18px] w-[18px]" />
          Compose
        </button>
        <button
          type="button"
          className={`flex flex-col items-center gap-0 py-0 text-[9px] font-medium leading-none ${
            peopleOpen ? "text-accent" : "text-muted"
          }`}
          onClick={() => {
            setPeopleOpen(true);
            setTemplatesOpen(false);
            setSelectedId(null);
          }}
        >
          <PeopleIcon className="h-[18px] w-[18px]" />
          Contacts
        </button>
        <button
          type="button"
          className={`flex flex-col items-center gap-0 py-0 text-[9px] font-medium leading-none ${
            templatesOpen ? "text-accent" : "text-muted"
          }`}
          onClick={() => {
            setTemplatesOpen(true);
            setPeopleOpen(false);
            setSelectedId(null);
          }}
        >
          <TemplateIcon className="h-[18px] w-[18px]" />
          Templates
        </button>
      </nav>

      {composeOpen ? (
        <Compose
          key={editingDraft?.id || reply?.id || composeTo || "new"}
          from={editingDraft ? mailboxAddress(editingDraft.mailbox) : composeMailbox(mailbox, session.mailboxes)}
          mailboxes={session.mailboxes.map((box) => box.address)}
          defaults={composeDefaults}
          draftId={editingDraft?.id}
          savedAttachments={editingDraft?.attachments ?? []}
          replyId={editingDraft?.inReplyTo || reply?.internetMessageId}
          threadId={editingDraft?.threadId || reply?.threadId}
          onClose={closeCompose}
          onDraftSaved={(from) => {
            closeCompose();
            setMailbox(from);
            setFolder("drafts");
            void refresh(from, "drafts");
          }}
          onSent={(from) => {
            closeCompose();
            setMailbox(from);
            setFolder("sent");
            void refresh(from, "sent");
          }}
        />
      ) : null}

      {pending?.kind === "trash" ? (
        <ConfirmDialog
          danger
          title={pending.ids.length > 1 ? `Move ${pending.ids.length} Messages to Trash` : "Move to Trash"}
          body={
            pending.ids.length > 1
              ? "These messages leave this folder and sit in Trash until you delete them forever."
              : "The message leaves this folder and sits in Trash until you delete it forever."
          }
          confirmLabel="Move to Trash"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await api("/api/messages/batch", {
              method: "POST",
              body: JSON.stringify({ ids: pending.ids, folder: "trash" }),
            });
            if (selectedId && pending.ids.includes(selectedId)) setSelectedId(null);
            setPicked([]);
            setPending(null);
            void refresh();
          }}
        />
      ) : null}
      {pending?.kind === "purge" ? (
        <ConfirmDialog
          danger
          title={pending.ids.length > 1 ? `Delete ${pending.ids.length} Messages` : "Delete Message"}
          body={
            pending.ids.length > 1
              ? "These messages and their files are removed for good. This cannot be undone."
              : "The message and its files are removed for good. This cannot be undone."
          }
          confirmLabel="Delete"
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            await api("/api/messages/batch", {
              method: "POST",
              body: JSON.stringify({ ids: pending.ids, deleteForever: true }),
            });
            if (selectedId && pending.ids.includes(selectedId)) setSelectedId(null);
            setPicked([]);
            setPending(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Action({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="btn-icon" aria-label={label} title={label}>
      {icon}
    </button>
  );
}

function ComposeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-[18px] w-[18px] shrink-0 ${className || ""}`} aria-hidden="true">
      <path
        d="M11.6 2.8 13.2 4.4 6.1 11.5 4 12l.5-2.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M3.2 13.2h9.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path d="M10 3.2 4.8 8 10 12.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function wireMessageLinks(doc: Document) {
  const body = doc.body;
  if (!body || (body as HTMLBodyElement & { __mailLinksWired?: boolean }).__mailLinksWired) return;
  (body as HTMLBodyElement & { __mailLinksWired?: boolean }).__mailLinksWired = true;

  body.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!href || href.startsWith("#")) return;
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  body.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href || href.startsWith("#")) return;
    event.preventDefault();
    window.open(anchor.href, "_blank", "noopener,noreferrer");
  });
}

function messageBodyHeight(doc: Document): number {
  const html = doc.documentElement;
  const body = doc.body;
  html.style.height = "auto";
  body.style.height = "auto";
  let height = Math.max(body.scrollHeight, html.scrollHeight, body.offsetHeight, html.offsetHeight, 80);
  for (const el of body.querySelectorAll("table, thead, tbody, tr, td, div, p, h1, h2, h3, img, a, hr, section")) {
    const bottom = el.getBoundingClientRect().bottom;
    if (Number.isFinite(bottom)) height = Math.max(height, bottom);
  }
  return Math.ceil(height + 8);
}

function MessageBody({ html, text }: { html: string; text: string }) {
  const { theme } = useTheme();
  const frame = useRef<HTMLIFrameElement>(null);

  function fit() {
    const node = frame.current;
    const doc = node?.contentDocument;
    if (!node || !doc?.body) return;
    wireMessageLinks(doc);
    const next = `${messageBodyHeight(doc)}px`;
    if (node.style.height !== next) node.style.height = next;
    doc.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", fit, { once: true });
    });
  }

  useEffect(() => {
    fit();
    const doc = frame.current?.contentDocument;
    if (!doc?.body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(doc.body);
    observer.observe(doc.documentElement);
    return () => observer.disconnect();
  }, [html, theme]);

  if (html) {
    return (
      <iframe
        ref={frame}
        title="Message body"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        onLoad={fit}
        className="block w-full overflow-hidden border-0 bg-surface"
        srcDoc={themedHtml(DOMPurify.sanitize(html), theme)}
      />
    );
  }
  return (
    <pre className="whitespace-pre-wrap text-[17px] leading-relaxed text-ink">
      {text || "Empty body"}
    </pre>
  );
}

function themedHtml(html: string, theme: Theme) {
  const dark = theme === "dark";
  const css = `
    :root { color-scheme: ${theme}; }
    html, body {
      background: ${dark ? "#1c1c1e" : "#ffffff"} !important;
      color: ${dark ? "#ffffff" : "#000000"} !important;
      margin: 0;
      padding: 4px 0 16px;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible;
      font: 17px/1.47 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      letter-spacing: -0.022em;
    }
    a { color: ${dark ? "#0a84ff" : "#007aff"}; }
    img { max-width: 100%; height: auto; }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`;
}

function Compose({
  from,
  mailboxes,
  defaults,
  draftId,
  savedAttachments,
  replyId,
  threadId,
  onClose,
  onSent,
  onDraftSaved,
}: {
  from: string;
  mailboxes: string[];
  defaults: { to: string; cc: string; bcc: string; subject: string; text: string; html: string };
  draftId?: string;
  savedAttachments: Array<{ id: string; filename: string }>;
  replyId?: string;
  threadId?: string;
  onClose: () => void;
  onSent: (from: string) => void;
  onDraftSaved: (from: string) => void;
}) {
  const [sender, setSender] = useState(from);
  const [to, setTo] = useState(defaults.to);
  const [cc, setCc] = useState(defaults.cc);
  const [bcc, setBcc] = useState(defaults.bcc);
  const [subject, setSubject] = useState(defaults.subject);
  const [mode, setMode] = useState<"text" | "html">(defaults.html.trim() ? "html" : "text");
  const [text, setText] = useState(defaults.text);
  const [html, setHtml] = useState(defaults.html);
  const [htmlPreview, setHtmlPreview] = useState(Boolean(defaults.html.trim()));
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [kept, setKept] = useState(savedAttachments);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"save" | "send" | "">("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api<EmailTemplate[]>("/api/templates?limit=50")
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setDirty(true);
      setter(value);
    };
  }

  async function payload(extra: Record<string, unknown> = {}) {
    const tooBig = files.find((file) => file.size > 8 * 1024 * 1024);
    if (tooBig) throw new Error(`${tooBig.name} is over 8 MB`);
    const attachments = await Promise.all(files.map(fileToPayload));
    return {
      from: sender,
      to,
      cc,
      bcc,
      subject,
      ...(mode === "html" ? { html, text: "" } : { text, html: "" }),
      inReplyTo: replyId,
      threadId,
      draftId,
      keepAttachmentIds: kept.map((item) => item.id),
      attachments,
      ...extra,
    };
  }

  async function saveDraft() {
    setBusy("save");
    setError("");
    try {
      await api("/api/drafts", {
        method: "POST",
        body: JSON.stringify(await payload()),
      });
      setDirty(false);
      setAskClose(false);
      onDraftSaved(sender);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save draft");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid bg-black/25 p-0 backdrop-blur-[2px] max-lg:items-end lg:place-items-center lg:p-8">
      <form
        className="sheet max-lg:h-[min(94dvh,100%)]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!to.trim()) {
            setError("Add at least one recipient");
            return;
          }
          setBusy("send");
          setError("");
          try {
            await api("/api/send", {
              method: "POST",
              body: JSON.stringify(await payload()),
            });
            onSent(sender);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Send failed");
          } finally {
            setBusy("");
          }
        }}
      >
        <div className="sheet-grabber" />
        <div className="flex items-center justify-between px-2 py-1">
          <button
            type="button"
            onClick={() => (dirty ? setAskClose(true) : onClose())}
            className="btn-ghost min-h-11 px-3 text-[17px]"
          >
            Cancel
          </button>
          <p className="text-[17px] font-semibold tracking-[-0.02em]">{draftId ? "Draft" : "New Message"}</p>
          <button type="submit" disabled={Boolean(busy)} className="btn-ghost min-h-11 px-3 text-[17px] font-semibold">
            {busy === "send" ? "Sending" : "Send"}
          </button>
        </div>
        <div>
          <Field label="From">
            <MenuSelect
              value={sender}
              onChange={touch(setSender)}
              options={mailboxes.map((address) => ({
                value: address,
                label: address,
              }))}
            />
          </Field>
          <Field label="To">
            <AddressField value={to} onChange={touch(setTo)} />
          </Field>
          <Field label="Cc">
            <AddressField value={cc} onChange={touch(setCc)} />
          </Field>
          <Field label="Bcc">
            <AddressField value={bcc} onChange={touch(setBcc)} />
          </Field>
          <Field label="Subject">
            <input
              value={subject}
              onChange={(event) => touch(setSubject)(event.target.value)}
              className="field"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 px-5 py-2 shadow-[inset_0_-0.5px_0_var(--color-line)]">
            <button
              type="button"
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                mode === "text" ? "bg-[var(--fill)] text-ink" : "text-muted"
              }`}
              onClick={() => {
                setDirty(true);
                setMode("text");
              }}
            >
              Plain
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                mode === "html" ? "bg-[var(--fill)] text-ink" : "text-muted"
              }`}
              onClick={() => {
                setDirty(true);
                setMode("html");
              }}
            >
              HTML
            </button>
            {mode === "html" ? (
              <button
                type="button"
                className="rounded-full px-3 py-1 text-[13px] font-medium text-muted"
                onClick={() => setHtmlPreview((value) => !value)}
              >
                {htmlPreview ? "Code" : "Preview"}
              </button>
            ) : null}
            {templates.length > 0 ? (
              <select
                className="ml-auto max-w-[12rem] truncate rounded-full bg-[var(--fill)] px-3 py-1 text-[13px] text-ink outline-none"
                defaultValue=""
                aria-label="Insert template"
                onChange={(event) => {
                  const id = event.target.value;
                  event.target.value = "";
                  const template = templates.find((item) => item.id === id);
                  if (!template) return;
                  setDirty(true);
                  setMode("html");
                  setHtml(template.html);
                  setHtmlPreview(true);
                  if (template.subject && !subject.trim()) setSubject(template.subject);
                }}
              >
                <option value="" disabled>
                  Template…
                </option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        {mode === "html" ? (
          htmlPreview ? (
            <iframe
              title="HTML preview"
              sandbox=""
              srcDoc={
                html ||
                "<p style='font-family:sans-serif;color:#6b7280;padding:24px'>HTML preview</p>"
              }
              className="min-h-0 w-full flex-1 border-0 bg-white"
            />
          ) : (
            <textarea
              value={html}
              onChange={(event) => touch(setHtml)(event.target.value)}
              className="min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed outline-none"
              placeholder="Paste HTML email…"
              spellCheck={false}
            />
          )
        ) : (
          <textarea
            value={text}
            onChange={(event) => touch(setText)(event.target.value)}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent px-5 py-4 text-[17px] leading-relaxed outline-none"
            placeholder="Message"
          />
        )}
        {kept.length || files.length ? (
          <div className="flex flex-wrap gap-2 px-5 py-3 shadow-[inset_0_0.5px_0_var(--color-line)]">
            {kept.map((file) => (
              <button
                key={file.id}
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--fill)] px-2.5 py-1.5 text-[13px] text-ink"
                onClick={() => {
                  setDirty(true);
                  setKept(kept.filter((item) => item.id !== file.id));
                }}
                aria-label={`Remove ${file.filename}`}
              >
                <ClipIcon />
                <span className="max-w-[12rem] truncate">{file.filename}</span>
                <CloseIcon />
              </button>
            ))}
            {files.map((file, index) => (
              <button
                key={`${file.name}-${index}`}
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--fill)] px-2.5 py-1.5 text-[13px] text-ink"
                onClick={() => {
                  setDirty(true);
                  setFiles(files.filter((_, item) => item !== index));
                }}
                aria-label={`Remove ${file.name}`}
              >
                <ClipIcon />
                <span className="max-w-[12rem] truncate">{file.name}</span>
                <CloseIcon />
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="px-5 text-[15px] text-danger">{error}</p> : null}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 shadow-[inset_0_0.5px_0_var(--color-line)]">
          <div>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                const next = Array.from(event.target.files || []);
                if (!next.length) return;
                setDirty(true);
                setFiles((current) => [...current, ...next]);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn-icon"
              aria-label="Attach"
              title="Attach"
              onClick={() => fileInput.current?.click()}
            >
              <ClipIcon />
            </button>
          </div>
          <button type="button" disabled={Boolean(busy)} className="btn-ghost px-4" onClick={() => void saveDraft()}>
            {busy === "save" ? "Saving" : "Save Draft"}
          </button>
        </div>
      </form>
      {askClose ? (
        <ConfirmDialog
          title="Unsaved Message"
          body="Save it to Drafts, or discard it."
          confirmLabel="Save Draft"
          altLabel="Discard Draft"
          altDanger
          onConfirm={() => void saveDraft()}
          onAlt={onClose}
          onCancel={() => setAskClose(false)}
        />
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="compose-row">
      <p>{label}</p>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SearchMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.2 10.2 13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <circle cx="6" cy="5.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.4 12.4c.3-2.2 1.7-3.4 3.6-3.4s3.3 1.2 3.6 3.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="11.2" cy="6" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 12.4c.2-1.5 1.1-2.4 2.4-2.4 1.3 0 2.2.8 2.5 2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function TemplateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 5.5h11M5.5 5.5v8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function InboxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path
        d="M2.5 8.5 4 3.5h8l1.5 5v4.2a.8.8 0 0 1-.8.8H3.3a.8.8 0 0 1-.8-.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M2.5 8.5h3.2l.8 1.5h3l.8-1.5h3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path
        d="m8 2.4 1.5 3.2 3.5.4-2.6 2.4.7 3.4L8 10.4 4.9 11.8l.7-3.4L3 6l3.5-.4Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path
        d="M13 11.5c0-3.2-2.1-5-6-5.2V4L3 7.6 7 11.2V9.1c2.4.1 4.3.8 6 2.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <rect x="2.2" y="3.8" width="11.6" height="8.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="m3 5 5 3.4L13 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function MailOpenIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path d="M2.4 6.2 8 3.2l5.6 3v6.2a.8.8 0 0 1-.8.8H3.2a.8.8 0 0 1-.8-.8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="m2.6 6.4 5.4 3.4 5.4-3.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ClipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path
        d="M6.2 8.6 9.4 5.4a2 2 0 0 1 2.8 2.8l-4.6 4.6a3.2 3.2 0 0 1-4.5-4.5l4.4-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function fileToPayload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    contentBase64: btoa(binary),
  };
}

function SentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12.5 8 8.5 11.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function DraftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path
        d="M4 13V4.8A.8.8 0 0 1 4.8 4H9l3 3v6a.8.8 0 0 1-.8.8H4.8A.8.8 0 0 1 4 13Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M9 4v3h3" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path d="M3 5.5h10v7.2a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 3.5h11v2h-11Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function SpamIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path d="M8 2.6 13.4 13H2.6Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.4v3.2M8 11.2v.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 ${className || ""}`} aria-hidden="true">
      <path d="M3.5 5h9l-.7 8.2a.8.8 0 0 1-.8.7H5a.8.8 0 0 1-.8-.7Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 5h11M6 5V3.4h4V5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
