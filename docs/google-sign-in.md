# Sign in with Google

**Let people open the panel with their Google account, invite them by email, and optionally switch passwords off.**

**Do it:** panel → **Settings → Sign in with Google** (owner).

**In 30 seconds**
- Google needs a sign-in client you create once in Google Cloud (about 5 minutes, free). The panel shows every
  value to copy.
- **Authorized JavaScript origins** are the address without a path and **without a slash at the end**
  (`https://agents.example.org`); **Authorized redirect URIs** end in `/auth/google/callback`.
- Changing the domain? Add the new address to the same client **before** you confirm it
  ([below](#when-the-panels-address-changes)).

## Set it up

1. **Create a Google Cloud project** (or pick one) and fill in *Branding* (app name, support email) and *Audience*
   (External; *Testing* is fine).
2. **Create the sign-in client:** *Web application*. Copy the values from the panel card with its **Copy** buttons:

   | Field in Google Cloud | Value (example) |
   |---|---|
   | Authorized JavaScript origins | `https://agents.example.org` |
   | Authorized redirect URIs | `https://agents.example.org/auth/google/callback` |

   The panel lists one pair per address it answers on (for example during a domain change).
3. **Paste the Client ID and secret** into the card → **Save and test**.
4. **Link your own account** (Settings → Your Google account), then invite others by email.

> [!IMPORTANT]
> Google rejects an origin that ends with `/` or contains a path, and it does not accept bare IP addresses: use your
> domain or the installer's `…sslip.io` name with HTTPS.

> [!TIP]
> **Only allow Sign in with Google** (Settings → Sign-in) turns passwords off. Locked out? On the server run
> `sudo duniya enable-password-login` ([command line](cli.md)).

## When the panel's address changes

Google sends people back to the panel address they started on (when it is one of the panel's own addresses;
anything else uses the main address). So **every address must be registered** in your Google sign-in client:

| You are… | Until the new address is registered |
|---|---|
| Added a new domain, not confirmed yet | Sign-in from the new address stops at Google with *Error 400: redirect_uri_mismatch*. The old address works. |
| Confirmed the new domain | Same for the new (main) address; the old address keeps working until you turn it off. Passwords still work (unless only Google is allowed). |
| Turned the old address off | Only registered addresses work: register the new one before this step. |

Fix: Google Cloud Console → **APIs & Services → Credentials** → your OAuth client → add the new origin and redirect
URI → **Save** (it can take a few minutes). **Settings → Web address & access** shows both values with copy buttons
while the switch runs, the Google card lists every address, and so does the page you land on when a sign-in that
started at one address came back to another (for example in another browser or window).

> [!NOTE]
> That page only lists the panel's own addresses and links back within the panel or to Google Cloud. The sign-in
> itself is still checked as always (state, PKCE, browser cookie, ID token), and an attempt is used once.

---
**Next:** [Domains & access](domains-and-access.md) · [Command line](cli.md) · [Docs index](README.md)
