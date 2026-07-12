# Runbook — Rotate the GitHub App private key

Rotate immediately if the key may have been exposed; otherwise rotate on your
normal credential schedule.

## Steps

1. **Generate the new key.** GitHub → Settings → Developer settings → GitHub
   Apps → *your app* → *Private keys* → **Generate a private key**. A `.pem`
   downloads; GitHub allows two active keys at once, so the old key keeps
   working during the swap.
2. **Update the Worker secret** (from the repository root):

   ```bash
   wrangler secret put GITHUB_APP_PRIVATE_KEY < downloaded-key.pem
   ```

   The Worker converts PKCS#1 PEM to PKCS#8 itself — upload the file exactly
   as GitHub issued it.
3. **Verify.** Open *Platform Health* — the GitHub connection must show
   `active` with a fresh *last success* after the next sync tick, or trigger a
   manual discovery from *Administration*. `GET /health/ready` must stay
   `ok: true` with `demoMode: false`.
4. **Revoke the old key.** Back on the GitHub App page, delete the previous
   private key.
5. **Clean up.** Delete the downloaded `.pem`. If you mirror the key in
   another secret store (e.g. a key vault), update it there too — the Worker
   only reads its own secret binding.

## Rollback

If verification fails, the old key is still valid until you delete it —
re-upload it with the same `wrangler secret put` command and investigate.
