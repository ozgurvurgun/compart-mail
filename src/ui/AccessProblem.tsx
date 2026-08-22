import { currentOrigin, signOutOfAccess } from "./access";

export function AccessProblem({ misconfigured }: { misconfigured?: boolean }) {
  return (
    <div className="grid h-full place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-surface p-8 text-center shadow-sm">
        <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-muted">Mail</p>
        <h1 className="mt-3 text-[22px] font-semibold text-ink">Cloudflare Access required</h1>
        <p className="mt-3 text-[14px] leading-6 text-muted">
          {misconfigured
            ? "Access is not configured on this worker. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, then protect this hostname in Zero Trust."
            : "Sign in through Cloudflare Access to open the mail panel. If you already did, try again or sign out of Access first."}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <a className="btn-primary w-full justify-center" href="/">
            Try again
          </a>
          {!misconfigured ? (
            <button
              type="button"
              className="btn-secondary w-full justify-center"
              onClick={() => signOutOfAccess(`${currentOrigin()}/`)}
            >
              Sign out of Access
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
