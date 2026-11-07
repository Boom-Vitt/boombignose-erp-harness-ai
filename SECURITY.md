# Security Policy

## Supported Versions

Security fixes are made on `main`. Include the affected release and commit in a report; do not upgrade or reset a live database just to report an issue. The confirmed published baseline is [1.4.4 (`ddc5c11`)](https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.4.4). Development-source local AI/OCR, headless deployment and mobile controls are not a claim that a newer release is published or fully verified.

## Reporting a Vulnerability

Please do not report security problems in public issues, discussions or pull requests.

Report them privately through GitHub Security Advisories: open the **Security** tab of this repository and choose **Report a vulnerability**, or go to <https://github.com/Boom-Vitt/nose-erp/security/advisories/new>.

If the **Report a vulnerability** button is not available, contact us privately through <https://boombignose.org> and ask for a secure channel. Leave exploit details out of that first message.

Include:

- what is affected (route, module or file) and the commit you tested
- the edition (Community or Pro)
- steps to reproduce, or a proof of concept
- the impact you expect, for example data from one organization becoming visible to another

We will confirm that we received your report, keep you informed while we work on it, and credit you in the advisory if you want. Please give us time to release a fix before you disclose the issue publicly.

## Scope

In scope: the application in this repository, its database migrations and Row Level Security policies, the Pro code in `ee/`, and the API routes under `app/api/`.

Out of scope: the demo accounts and seed data, which are public by design and meant for local development only, and problems in third-party services such as Supabase, n8n or email providers. Report those to the vendor.

## Current-source security boundaries

- **Native local stack:** Go/Wails desktop or the separate headless Go CLI supervises Node/Next ERP, PostgreSQL, Auth, PostgREST and Ollama. Private services remain on distinct loopback ports. Remote access must use a reviewed HTTPS front door to ERP only; do not forward Auth/API/REST/DB/model ports.
- **Browser Auth:** native login, refresh and MFA requests use the fixed same-origin `/auth/local/*` relay, not a generic proxy or delegated-owner login. The Supabase browser client's session cookies are JavaScript-readable (`@supabase/ssr` defaults), **not all httpOnly**. The active-workspace cookie is separate and httpOnly. XSS/extension protection and not logging tokens remain essential.
- **Authorization:** business operations use verified session membership, role/capability checks and workspace RLS. Enrolled verified MFA factors require AAL2 at shared page/API gates; unknown assurance fails closed. This does not force every user to enroll MFA, nor prove every SQL policy independently enforces it. Network staff policies enforce assurance in the database as well.
- **Privileged server exceptions:** service-role bypasses RLS and is server-only, not seed-only. Cron jobs, public lead/invitation tokens, invitation account provisioning, mobile connection records and network ingest have dedicated secret/token/session boundaries and must explicitly scope operations. Never expose that credential to a browser, QR, error or log.
- **Machine-wide operations:** model installation/removal, ASR installation/removal, desktop update, native host-window control and browser DB backup/restore require verified session/MFA, owner/admin capability, mutation Origin checks and an OS-enrolled machine-operator UUID. Unauthorized window capability discovery returns `desktop:false` without contacting the native helper; commands remain denied. A workspace owner cannot automatically change shared host resources or dump all workspaces. `configure-operators` is a local OS-owner action; inherited operator environment is ignored.
- **Storage:** new native clusters use distinct random role credentials with SCRAM. Old trust clusters require explicit offline `secure-db`; no automatic data reset. Private permissions/Windows ACLs are access controls, **not at-rest encryption**. HTTPS/Tailscale encrypt network transport only; database files, attachments, native secrets and downloaded dumps require disk/backup encryption under the operator's control.
- **Local AI/OCR:** loopback endpoints plus local-model metadata checks reject remote/cloud aliases before business data. Model pulls explicitly contact registries; spawned Ollama is no-cloud, but an independently managed daemon/compromised OS is outside that guarantee. OCR/AI output remains untrusted and requires human review; no automatic financial posting or cloud fallback.
- **Private mobile:** Tailscale device/ACL authorization is additional to normal ERP login/MFA/invitations. QR pairing is connection-only, not a session or role grant. Unlinking a connection record does not sign out browser sessions, and removing a tailnet device cannot erase downloaded data.

See [deployment, migration and recovery](./docs/boombignose/BUNDLE.md#headless-server-installation-and-private-access), [PDPA responsibilities and source references](./docs/PDPA_SECURITY_NOTES.md), and [native network-collector limits](./boombignose/README.md#native-macos-network-collector). Network 3D is observational metadata, not DLP/firewall enforcement or a guarantee of no leakage. These controls do not constitute Thai legal/cybersecurity certification, final model/OCR accuracy, successful recovery, or real-phone acceptance evidence.
