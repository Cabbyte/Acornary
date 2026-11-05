# Native migration acceptance evidence

Evidence recorded on 2026-11-05. Baseline: `18f7e0496ecb4fb960a6619f12f57c68b3898410`. Existing production and its working tree were not modified. This document distinguishes implementation from release acceptance; the complete application is not yet deployed to the preview domain.

| Check | Observed result | Remaining boundary |
| --- | --- | --- |
| Public operations | 54 schemas, classifications and descriptions match the frozen baseline; all operations execute in native inventory tests | Real AI client workflows |
| Pure domain/UI tests | 144 pass, 2 pre-existing diagnostic TODOs | These do not replace workerd integration |
| Native workerd | Kernel 8, inventory 17, D1 credential commands 4, HTTP 6, PostgreSQL snapshot/import 14, unified backup/restore suite pass | Real Cloudflare full-runtime acceptance |
| HTTP/OAuth/MCP | Actual D1 auth, PKCE/consent, scope/audience checks, refresh, MCP schemas, REST, 25 MiB attachments and revocation pass locally | Actual ChatGPT/Codex authorization and live JWKS path |
| Browser | Existing full browser suite on native workerd: 70 pass, 3 registration/recovery cases skipped because those features remain closed. Real Chrome with local HTTPS Worker: password login, family creation, catalogue proposal/review/approval, item creation, reload persistence, account page, WebAuthn registration and subsequent Passkey login pass | Production-quality TLS and physical authenticators. The automated suite uses a trusted test certificate and also passes offline service-worker checks |
| WebKit | 15 responsive, focus, offline-write, Chinese input and MCP iframe scenarios pass on macOS WebKit; pointer activation now preserves the sheet trigger for focus restoration | Physical mobile Safari |
| Mobile Web | 390 × 844 screenshot inspected: explicit preview banner, no horizontal overflow, item and bottom navigation visible | Mobile browser/device acceptance |
| Backup operator | Private service-binding CLI creates a COMPLETE backup; restores the browser family into separate empty local D1/DO/R2; one-family restore measured 0.229 seconds | Remote RTO, larger data and actual Queue delivery |
| Android provisioning | Preview-only OAuth client creation and identical retry pass against local D1 | Real App Links/OAuth/device/printing; CI build/lint/emulator pass, APK certificate matches the preview fingerprint |
| CIMD real platform probe | Same Worker public front door reached; credentials stripped; redirects, >64 KiB responses, 5-second deadline and private IP literals rejected | Same custom zone and controlled dynamic DNS rebinding exercise |
| Private DNS probe | Three public names resolving to 127.0.0.1, 10.0.0.1 and 169.254.169.254 returned Cloudflare 530/1016; public A records independently checked | This is not a completed dynamic DNS rebinding experiment |
| Release build | Actual Static Assets and Worker dry-run pass; isolated resources are provisioned | Full app deploy rejected on Free plan, error 100328 |
| Source migration | Disposable PostgreSQL-to-D1/DO/R2 consistency and bytes verified | Production SSH unavailable; no production snapshot acquired |

The browser used a virtual WebAuthn authenticator. Local self-signed TLS allowed page navigation, but the service-worker fetch reported a certificate error. That initial manual run did not prove offline/PWA behavior. The later automated native suite trusts only its generated test certificate and passes offline checks; real-domain TLS remains a separate gate. Evidence files are under ignored `output/playwright/`; secret fixture state remains under ignored `.local/`.

The network diagnostic was a small, disposable Worker (deleted after the checks), separate from the application, containing no inventory or account data. It does not bind the requested preview Custom Domain. No claim is made that ordinary fetch reproduces the former Node DNS-pinning transport.

Pending user prerequisites are Workers Paid, production SSH connectivity for the read-only snapshot, and the GitHub Environment deployment token for automatic releases. The OAuth login itself is working. Real clients, physical hardware, remote restore and the seven-day comparison remain release gates after these prerequisites are resolved.
