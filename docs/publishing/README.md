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

For printor, create:

```text
Type: CNAME
Name: printor
Target: panzzyr.github.io
TTL: Auto
```

Do not use a wildcard record. DNS can take up to 24 hours to settle, although
it is often much faster.

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
