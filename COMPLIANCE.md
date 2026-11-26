# Lunex compliance checklist

Lunex checked against a 20-point "don't get sued" checklist on 2026-11-26. This is a code review, not legal advice. Because Lunex takes payments and gives crypto trading signals, have a lawyer read the final policies.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Privacy policy | ✅ Added | `/privacy` (`privacy.html`): data collected, services used, retention, US state privacy rights, deletion. |
| 2 | Terms of service | ✅ Added | `/terms` (`terms.html`): not financial advice, risk, 18+, auto-renewal, liability, governing law. |
| 3 | Refund policy | ✅ Added | `/refunds` (`refunds.html`): payments final, cancel anytime, listed exceptions (double charges, Pro not activated, Lunex shutting down). |
| 4 | Cookie policy | ✅ Added | `/cookies` (`cookies.html`): one session cookie, localStorage, Google and Stripe. |
| 5 | Cookie consent banner | ⚠️ Probably not needed | Essential cookies only. Google Sign-In and Google Fonts send the visitor's IP to Google, so EU visitors need a notice. Self-hosting the fonts removes the Fonts issue. |
| 6 | Form consents | ✅ Added | Sign-up requires ticking a box (18+, Terms, Privacy), checked by the server too, and the time is saved in `users.terms_accepted`. Checkout links the Terms and Refund Policy. |
| 7 | Collect only needed data | ✅ OK | Only a public wallet address. The wallet field rejects seed phrases. |
| 8 | Audit third-party SDKs | ⚠️ List them | Google Sign-In, Google Fonts, Stripe, esm.sh (web3.js, spl-token, qrcode), CoinGecko, DexScreener, PumpPortal. Name them in the privacy policy. |
| 9 | Remove dark patterns | ✅ OK | The renewal banner can be dismissed, and Pro is easy to decline. Monthly is selected by default but clearly labelled. |
| 10 | No hidden fees | ✅ OK | Pro now shows $20/month up front, and renewal terms sit under the button. Trades show the PumpPortal 0.5% fee and network fees. |
| 11 | No fake reviews | ✅ OK | There are no testimonials. |
| 12 | No unsupported claims | ⚠️ Fixed one | Changed "Pro to win" to "Pro to act". The "84% confidence" chat and "~1 second" are sample or performance claims, so keep them accurate. |
| 13 | Alt text | ⚠️ Check | Coin logos use `alt=""`, which is fine because they're decorative. Any meaningful images need real alt text. |
| 14 | Color contrast | ✅ Mostly OK | `--faint` (#7d7b89) on #060608 is about 4.8:1, which passes AA for body text. |
| 15 | Keyboard navigation | ⚠️ Check | Most controls are buttons. The account menu uses `role="menu"` but has no arrow-key handling. Either add it or drop the role. |
| 16 | Business details | ✅ Added | Footers show the name, "United States" and the contact email, taken from the `LUNEX_LEGAL_NAME` and `LUNEX_CONTACT_EMAIL` env vars. |
| 17 | Age consent | ✅ Added | 18+ checkbox at sign-up, required for new email and Google accounts. |
| 18 | Unsubscribe link | ✅ Added | The weekly recap has a signed one-click unsubscribe link and a List-Unsubscribe header, plus an on/off switch in Account settings. The footer needs your postal address (`LUNEX_POSTAL_ADDRESS`), which US CAN-SPAM law requires. |
| 19 | License stock images | ⚠️ Confirm | Confirm you have the rights to `assets/lunar-hero.png` and `assets/lunar-terrain.png`. |
| 20 | Data deletion option | ✅ Added | Account menu → Delete account (type your email to confirm). Card subscriptions are cancelled in Stripe first. Payment records are kept without the account. |

## Before going live
Set these in Railway → Variables. Until you do, the pages show `[set …]` placeholders:
- `LUNEX_LEGAL_NAME`: the legal name of the business
- `LUNEX_CONTACT_EMAIL`: support and privacy email
- `LUNEX_LEGAL_STATE`: US state for governing law in the Terms
- Weekly recap email: `LUNEX_SMTP_HOST`, `LUNEX_SMTP_PORT`, `LUNEX_SMTP_USER`, `LUNEX_SMTP_PASS`, `LUNEX_MAIL_FROM`, `LUNEX_POSTAL_ADDRESS`, `LUNEX_PUBLIC_URL` (see `recap.py`). Without these, no email is sent.
- Optional: `LUNEX_SECRET` signs unsubscribe links. If it's unset, one is generated and stored in the database.

## Community Calls moderation
- Three user reports hide a message automatically.
- `python server.py chat-hide <id>` hides any message.
- Links in posts are shown as plain text and can't be clicked, which makes phishing harder.
