# Publishing on GitHub Pages

The portfolio and printor are separate repositories and separate Pages sites:

- `panzzyr/sazonov` → `sazonov.space`
- `panzzyr/printor` → `printor.sazonov.space`

Both repositories deploy automatically from `main` with GitHub Actions.

## GitHub settings

In each repository, open **Settings → Pages** and select **GitHub Actions** as
the source. After the first successful workflow run, enter the corresponding
custom domain and enable **Enforce HTTPS** when GitHub makes it available.

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

The Actions tab shows build and deployment status. Repository texture scans
belong in `printor/public/textures/`; one-off scans loaded in the browser never
leave the device and are not persisted to Git.
