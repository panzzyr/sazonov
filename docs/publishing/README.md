# Publishing on GitHub Pages

The portfolio and printor are separate repositories and separate Pages sites:

- `panzzyr/sazonov` → `sazonov.space`
- `panzzyr/printor` → `printor.sazonov.space`

Both repositories deploy automatically from `main` with GitHub Actions.

`panzzyr/sazonov` is the monorepo and the source of truth; its Pages workflow
publishes `apps/site/`. `panzzyr/printor` is a standalone mirror of
`apps/printor/`, kept in sync with:

```sh
rsync -a --delete --exclude node_modules/ --exclude dist/ --exclude .git/ \
  apps/printor/ printor/
```

## GitHub settings

In each repository, open **Settings → Pages** and select **GitHub Actions** as
the source. After the first successful workflow run, enter the corresponding
custom domain and enable **Enforce HTTPS** when GitHub makes it available.

Two things block a deployment if they are missing:

- **Pages must be enabled before the workflow runs**, otherwise
  `actions/configure-pages` fails with `Get Pages site failed`.
- **Pages on a private repository needs a paid GitHub plan.** A free account
  must make the repository public first.

The custom domain is not read from the committed `public/CNAME` when deploying
through Actions — set it in **Settings → Pages**, or with:

```sh
gh api -X PUT repos/panzzyr/printor/pages -f cname=printor.sazonov.space
```

Until a root domain is attached, the `panzzyr.github.io/printor/` URL serves a
broken page: the build emits root-absolute asset paths (`/assets/...`), which do
not resolve under a subpath. This is expected and resolves itself once the
custom domain is live.

## DNS records

Create the records at the DNS provider that currently manages
`sazonov.space`. Cloudflare registration is not required.

For the apex portfolio, create four `A` records with name `@`:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

### The printor subdomain, step by step

`printor.sazonov.space` is a third-level name, so it takes a `CNAME` record
rather than the four `A` records the apex needs.

1. At the DNS provider for `sazonov.space`, add:

   ```text
   Type:   CNAME
   Name:   printor          ← just the label, not the full name
   Target: panzzyr.github.io
   TTL:    Auto
   ```

   The target is the *user* domain `panzzyr.github.io` with no repository path
   and no trailing dot beyond what the provider adds itself. If the provider
   demands a fully qualified name, enter `printor.sazonov.space`.

   On Cloudflare, set the proxy status to **DNS only** (grey cloud). Leaving it
   proxied (orange) breaks GitHub's domain verification and its certificate
   issuance.

2. Confirm the record has propagated. Query a public resolver directly, because
   a local VPN or corporate resolver will happily answer with its own address:

   ```sh
   dig +short printor.sazonov.space CNAME @1.1.1.1
   # expected: panzzyr.github.io.
   ```

3. Only then attach the domain in GitHub, either in **Settings → Pages** or
   with:

   ```sh
   gh api -X PUT repos/panzzyr/printor/pages -f cname=printor.sazonov.space
   ```

   Setting it before DNS resolves makes GitHub reject the domain and the site
   stays unreachable until you set it again.

4. Wait for the DNS check to pass, then enable **Enforce HTTPS**. The
   certificate can take up to an hour after the domain verifies.

```sh
gh api repos/panzzyr/printor/pages --jq '{cname, status, https_certificate: .https_certificate.state}'
```

Do not use a wildcard record. DNS can take up to 24 hours to settle, although
it is often much faster.

## Working on printor while DNS settles

Nothing about local development depends on the domain. Both of these serve the
app from the root path, which is what the build assumes:

```sh
pnpm dev:printor        # from the monorepo root → http://127.0.0.1:5173
cd printor && pnpm dev  # from the standalone mirror
```

To check exactly what will be deployed, build and preview the production output:

```sh
pnpm --filter @sazonov/printor build
pnpm --filter @sazonov/printor exec vite preview   # → http://localhost:4173
```

`vite preview` serves `dist/` at the root, so textures, the service worker, and
the `/support` route all resolve the way they will in production. This is the
right way to sanity-check a build — unlike `panzzyr.github.io/printor/`, which
cannot work until the site sits on a root domain.

## Routine updates

Run checks in the repository you changed, then push `main`:

```sh
pnpm install
pnpm test
pnpm build
git add .
git commit -m "feat: describe the change"
git push
```

The Actions tab shows build and deployment status.

The committed texture library lives in `apps/printor/public/textures/` and is
generated from full-resolution scans under `assets/`, which stay out of git.
Regenerate it with `node scripts/build-texture-library.mjs` after adding a scan.
