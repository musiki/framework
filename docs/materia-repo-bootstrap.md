# Materia Repo Bootstrap

Use the local scaffold to create the first repo or vault for a subject team.

## Command

```bash
npm run repo:materia:new -- \
  --target ../i1 \
  --subject-name "Instrumento I" \
  --subject-slug i1 \
  --course-title "Instrumento I" \
  --course-id i1
```

Optional flags:

- `--org musiki`
- `--platform-owner musiki`
- `--platform-repo framework`
- `--teachers-team @musiki/docentes-i1`
- `--editorial-team @musiki/editorial`
- `--devs-team @musiki/devs`
- `--dry-run`

## What gets generated

- `README.md`
- `.gitignore`
- `CODEOWNERS`
- `.github/workflows/notify-platform-on-content-change.yml`
- `.github/pull_request_template.md`
- `cursos/<course-id>/...` with sample notes
- empty `public/**`
- empty `draft/**`
- `.obsidian/`
- `assets/`

## After scaffold

1. Create the GitHub repo and push the generated directory.
2. Add the secret `PLATFORM_DISPATCH_TOKEN` to the new repo.
3. Replace sample notes under `cursos/<course-id>/`.
4. Confirm `CODEOWNERS` and branch protection rules.
5. Register the new source in the framework manifest.

## Framework manifest snippet

Add an entry like this to [config/sources.manifest.json](/Users/zztt/projects/26-musiki/framework/config/sources.manifest.json):

```json
{
  "id": "i1",
  "enabled": true,
  "repo": "musiki/i1",
  "branch": "main",
  "contentRoot": ".",
  "localPath": "../i1"
}
```

## Policy reminder

- `public/**` is canonical public content and should go through pull requests.
- `cursos/**` is canonical course content and can move faster.
- `draft/**` is incubator material and should not publish directly.
- `src/content` in this framework repo is assembled output, not authoring source.
