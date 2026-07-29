# Publishing

The repository deploys as two Cloudflare Pages projects connected to one
GitHub repository.

## 1. Push the repository to GitHub

From the repository root:

```sh
git init -b main
git add .
git commit -m "feat: launch portfolio and printor"
gh repo create sazonov --public --source=. --remote=origin --push
```

If the repository already exists on GitHub, replace the last command with:

```sh
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Never commit Cloudflare tokens or other secrets.

## 2. Create the portfolio Pages project

In Cloudflare Dashboard, open **Workers & Pages → Create → Pages → Connect to
Git** and select the repository.

Use:

| Setting | Value |
| --- | --- |
| Project name | `sazonov-space` |
| Production branch | `main` |
| Root directory | repository root |
| Build command | `pnpm --filter @sazonov/site build && node scripts/budget.mjs` |
| Build output directory | `apps/site/_site` |
| Node version | `22` |

Attach the custom domain `sazonov.space` under **Custom domains**.

## 3. Create the printor Pages project

Create a second Pages project from the same Git repository:

| Setting | Value |
| --- | --- |
| Project name | `printor` |
| Production branch | `main` |
| Root directory | repository root |
| Build command | `pnpm --filter @sazonov/printor build` |
| Build output directory | `apps/printor/dist` |
| Node version | `22` |

Attach `printor.sazonov.space` under **Custom domains**. Associate the custom
domain in Pages before manually changing DNS; Cloudflare creates the record
automatically when the zone is already active.

## 4. DNS

To serve the apex domain from Pages, add `sazonov.space` as a Cloudflare zone
and point the registrar's nameservers to the pair Cloudflare assigns. Wait
until the zone is active before attaching both custom domains.

Optionally redirect `www.sazonov.space` to `https://sazonov.space` with a
Cloudflare Bulk Redirect.

## 5. Routine updates

Create a branch, edit, and verify:

```sh
git switch -c feat/change-name
pnpm check
git add .
git commit -m "feat(site): describe the change"
git push -u origin feat/change-name
```

Open a pull request on GitHub. Cloudflare creates preview deployments for both
projects. After the pull request is merged into `main`, both production
projects deploy automatically.
