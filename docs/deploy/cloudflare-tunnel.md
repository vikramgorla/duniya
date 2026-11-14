# Example: Cloudflare Tunnel (optional)

Use this when you want the panel on your own domain **without opening any ports** on the server. It's optional: the
installer can also serve the panel directly over HTTPS (`--domain` or `--ip-https`).

1. Your domain must be on Cloudflare.
2. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**; name it.
3. Copy the token from the install command shown (the long string after `--token`).
4. **Public hostname**: e.g. `agents.example.com` → service **HTTP** → `localhost:8080`
   (Docker: `app:8080`).
5. Install with the token:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/vikramgorla/whatsapp-agent-duniya/main/install.sh | sudo bash -s -- --cloudflare-token <token>
   ```

6. Recommended: **Zero Trust → Access → Applications → Self-hosted** for the same hostname with a policy like
   *Emails = you*. Visitors then need an email code before they even reach the panel's own login.
