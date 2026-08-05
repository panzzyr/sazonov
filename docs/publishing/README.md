# Publishing on GitHub Pages

One repository, one Pages deployment. The portfolio occupies the root and
printor is nested underneath it:

- `sazonov.space` → `apps/site/`
- `sazonov.space/printor/` → `apps/printor/`

`pnpm build` produces both: it builds the site into `apps/site/_site/`, builds
printor, then `scripts/nest-printor.mjs` copies `apps/printor/dist/` into
`apps/site/_site/printor/`. The Pages workflow uploads `apps/site/_site` and
nothing else.

printor is built with Vite `base: "/printor/"`, so its asset, texture, service
worker, and `/printor/support/` URLs all point at the sub-path. Set
`PRINTOR_BASE=/` to build it for a root domain instead.

## GitHub settings

Open **Settings → Pages** and select **GitHub Actions** as the source. Two
things block a deployment if they are missing:

- **Pages must be enabled before the workflow runs**, otherwise
  `actions/configure-pages` fails with `Get Pages site failed`.
- **Pages on a private repository needs a paid GitHub plan.** On a free
  account the repository has to be public first
  (**Settings → General → Change repository visibility**).

After the first successful run, enter `sazonov.space` as the custom domain and
enable **Enforce HTTPS** once GitHub offers it. The committed
`apps/site/src/public/CNAME` keeps the domain across deployments.

## DNS records

Create the records at the DNS provider that manages `sazonov.space`.

For the apex, create four `A` records with name `@`:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optionally add a `CNAME` with name `www` and target `panzzyr.github.io`.

**No subdomain is needed for printor.** It is a path on the portfolio, so it
inherits the apex record and its certificate. Nothing extra to configure.

On Cloudflare, set the proxy status to **DNS only** (grey cloud). Leaving it
proxied (orange) breaks GitHub's domain verification and certificate issuance.

Verify against a public resolver rather than the system one, which a VPN or a
corporate network will happily answer with its own address:

```sh
dig +short sazonov.space A @1.1.1.1
gh api repos/panzzyr/sazonov/pages --jq '{cname, status}'
```

DNS can take up to 24 hours to settle, although it is often much faster.

## Working locally while DNS settles

Nothing about local development depends on the domain.

```sh
pnpm dev:site       # portfolio at http://localhost:8080
pnpm dev:printor    # printor at http://127.0.0.1:5173
```

The printor dev server runs it at the root of its own port, which is fine — the
base only matters for a production build. To check exactly what will deploy,
including the `/printor/` sub-path, build and serve the combined output:

```sh
pnpm build
python3 -m http.server 5180 --directory apps/site/_site
```

Then open `http://127.0.0.1:5180/` and `http://127.0.0.1:5180/printor/`. This is
the only way to confirm the sub-path wiring — textures, the service worker, and
the `/printor/support/` route — before pushing.

## Routine updates

```sh
pnpm check          # lint, build, test — what CI runs
git add .
git commit -m "feat: describe the change"
git push
```

The Actions tab shows build and deployment status.

The committed texture library lives in `apps/printor/public/textures/` and is
generated from full-resolution scans under `assets/`, which stay out of git.
Regenerate it with `node scripts/build-texture-library.mjs` after adding a scan.
